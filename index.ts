/**
 * hydro-award — 洛谷风格奖项认证插件
 *
 * 数据模型:
 *   award.setting  { uid(unique), level(0-10,管理员设定), hideHook(bool) }
 *   award.record   { _id, uid, year, contest, prize, hidden, createAt }
 *
 * 认证等级由管理员直接设定(0-10),与获奖记录无关;获奖记录由管理员导入管理。
 * 钩子颜色(固定规则): 1-2 级 #BFBFBF / 3-5 级 #52c41a / 6-7 级 #3498db / 8-10 级 #ffc116
 *
 * 路由:
 *   GET  /reward                 管理页(仅 root):用户列表 UID|用户名|等级|获奖记录(查看)
 *   GET  /reward/records?uid=    某用户获奖记录 JSON(仅 root,弹窗用)
 *   POST /reward/setting/save    设定用户认证等级 { uid, level }(仅 root)
 *   POST /reward/record/save     保存记录 { _id?, uid, year, contest, prize, hidden }(仅 root)
 *   POST /reward/record/delete   删除记录 { _id }(仅 root)
 *   GET  /award/badges.json      公开:uid → { level, color }(未隐藏钩子的用户)
 *   GET  /award/user?uid=        用户的奖项数据(本人/root 附全部记录)
 *   POST /award/hide             本人/root 更新隐私 { uid, hideHook, hiddenIds }
 *   GET  /award/award.js         全站前端脚本(由 layout/basic.html 覆盖引入)
 *
 * 模板:
 *   templates/reward.html        管理页
 *   templates/layout/basic.html  覆盖官方,引入 /award/award.js
 */
import {
    Context, ForbiddenError, Handler, PRIV, UserModel, db, nanoid,
} from 'hydrooj';

const settingColl = db.collection('award.setting');
const recordColl = db.collection('award.record');

function isRoot(user: any) {
    return user.hasPriv(PRIV.PRIV_SUPERADMIN) || user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
}

/** 钩子颜色(固定规则) */
function hookColor(level: number): string {
    if (level >= 1 && level <= 2) return '#BFBFBF';
    if (level >= 3 && level <= 5) return '#52c41a';
    if (level >= 6 && level <= 7) return '#3498db';
    if (level >= 8) return '#ffc116';
    return '#BFBFBF';
}

/**
 * 全站前端脚本:
 * 1. 拉取 badges.json,在所有 .user-profile-link 的徽章(Tag)右侧插入洛谷 badge-check 钩子
 *    (无徽章时紧跟用户名),MutationObserver 监听动态插入的列表(如犇犇)。
 * 2. 用户中心(/user/:uid)在"已递交/已通过/题解被赞"卡片下方插入奖项卡片:
 *    第一行"奖项认证:N 级 + 钩子",第二行起"[年份] 比赛 等级"。
 *    本人可点"编辑"隐藏钩子或单个奖项(仅隐藏不删除)。
 */
const AWARD_JS = `(function () {
  function HOOK_SVG(color, style) {
    return '<svg data-v="3" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="' + color + '" style="' + (style || 'margin-left:2px;margin-bottom:-5px') + '">'
      + '<path d="M16 8C16 6.84375 15.25 5.84375 14.1875 5.4375C14.6562 4.4375 14.4688 3.1875 13.6562 2.34375C12.8125 1.53125 11.5625 1.34375 10.5625 1.8125C10.1562 0.75 9.15625 0 8 0C6.8125 0 5.8125 0.75 5.40625 1.8125C4.40625 1.34375 3.15625 1.53125 2.34375 2.34375C1.5 3.1875 1.3125 4.4375 1.78125 5.4375C0.71875 5.84375 0 6.84375 0 8C0 9.1875 0.71875 10.1875 1.78125 10.5938C1.3125 11.5938 1.5 12.8438 2.34375 13.6562C3.15625 14.5 4.40625 14.6875 5.40625 14.2188C5.8125 15.2812 6.8125 16 8 16C9.15625 16 10.1562 15.2812 10.5625 14.2188C11.5938 14.6875 12.8125 14.5 13.6562 13.6562C14.4688 12.8438 14.6562 11.5938 14.1875 10.5938C15.25 10.1875 16 9.1875 16 8ZM11.4688 6.625L7.375 10.6875C7.21875 10.8438 7 10.8125 6.875 10.6875L4.5 8.3125C4.375 8.1875 4.375 7.96875 4.5 7.8125L5.3125 7C5.46875 6.875 5.6875 6.875 5.8125 7.03125L7.125 8.34375L10.1562 5.34375C10.3125 5.1875 10.5312 5.1875 10.6562 5.34375L11.4688 6.15625C11.5938 6.28125 11.5938 6.5 11.4688 6.625Z"></path></svg>';
  }
  function HOOK_COLOR(level) {
    if (level >= 1 && level <= 2) return '#BFBFBF';
    if (level >= 3 && level <= 5) return '#52c41a';
    if (level >= 6 && level <= 7) return '#3498db';
    if (level >= 8) return '#ffc116';
    return '#BFBFBF';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function post(url, data) {
    var body = Object.keys(data).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(data[k]);
    }).join('&');
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body,
    }).then(function (r) { return r.json(); }).then(function (j) { return !!j.ok; }).catch(function () { return false; });
  }

  /* ---------- 1. 全站用户名旁钩子 ---------- */
  var badges = null;
  var timer = null;

  function injectHooks(root) {
    if (!badges) return;
    var names = root.querySelectorAll('a.user-profile-name');
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (name.getAttribute('data-award-done')) continue;
      if (name.closest('.benben-item__content')) continue;
      name.setAttribute('data-award-done', '1');
      /* 规则:钩子跟随"位置"而非"用户"——凡是会渲染自定义 Tag 的位置,都给有认证等级的用户
         显示钩子(该用户自己有没有 Tag 都显示);不渲染 Tag 的位置一律不显示。
         位置由模板声明:宏/模板输出 data-tag-scope 属性
         (components/user.html 里 badge=true 时输出;犇犇列表、关注/粉丝列表自带)。
         题目上传者/比赛主持人/讨论列表/工单列表/提交记录列表等 badge=false 的位置没有该属性,
         因此自动排除,无需维护页面黑名单。 */
      var scope = name.closest('[data-tag-scope]');
      if (!scope) continue;
      var m = /user\\/(\\d+)/.exec(name.getAttribute('href') || '');
      if (!m) continue;
      var b = badges[m[1]];
      if (!b) continue;
      var span = document.createElement('span');
      span.className = 'award-hook';
      span.setAttribute('data-tooltip', '奖项认证:' + b.level + ' 级');
      span.innerHTML = HOOK_SVG(b.color);
      /* 插在最后一个徽章之后(自定义 Tag 后还有 MOD/SU 时,钩子在 MOD/SU 后面) */
      var bs = scope.querySelectorAll('.user-profile-badge');
      var ref = bs.length ? bs[bs.length - 1] : name;
      ref.insertAdjacentElement('afterend', span);
    }
  }
  function scheduleInject() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; if (badges) injectHooks(document.body); }, 120);
  }
  fetch('/award/badges.json').then(function (r) { return r.json(); }).then(function (j) {
    badges = j || {};
    injectHooks(document.body);
  }).catch(function () { });
  new MutationObserver(scheduleInject).observe(document.documentElement, { childList: true, subtree: true });
  /* 兜底轮询:覆盖懒加载/前端渲染的页面(讨论、工单等),30 秒后停止 */
  var ticks = 0;
  var fallback = setInterval(function () {
    ticks++;
    if (badges) injectHooks(document.body);
    if (ticks >= 15) clearInterval(fallback);
  }, 2000);

  /* ---------- 2. 用户中心奖项卡片 ---------- */
  var cardState = null;

  function renderCard() {
    var old = document.getElementById('award-card-section');
    if (old) old.remove();
    var stat = document.querySelector('.sidebar-user-stat');
    if (!stat) return;
    var j = cardState;
    if (!j || (!j.level && !(j.records && j.records.length))) return;
    var hook = j.level > 0 ? HOOK_SVG(HOOK_COLOR(j.level), 'margin-left:-1px;margin-bottom:-3px') : '';
    var list = '';
    (j.records || []).forEach(function (r) {
      list += '<div style="display:flex;gap:6px;align-items:center;padding:3px 0;font-size:13px">'
        + '<span style="color:#888">[' + esc(r.year) + ']</span>'
        + '<span style="font-weight:500">' + esc(r.contest) + '</span>'
        + '<span style="margin-left:auto;color:#555">' + esc(r.prize) + '</span></div>';
    });
    if (!list) list = '<div style="color:#999;font-size:13px;padding:4px 0">暂无公开奖项</div>';
    var editBtn = j.canEdit
      ? '<a id="award-edit-btn" style="cursor:pointer;color:#3498db;font-size:12px;margin-left:auto" href="javascript:;">编辑</a>'
      : '';
    var section = document.createElement('div');
    section.className = 'section side';
    section.id = 'award-card-section';
    section.innerHTML = '<div class="section__body"><div id="award-card">'
      + '<div style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;padding-bottom:4px">'
      + '<span>奖项认证:' + (j.level || 0) + ' 级</span>' + hook + editBtn + '</div>' + list + '</div></div>';
    var statSection = stat.closest('.section.side') || stat.parentElement;
    if (statSection && statSection.parentElement) {
      statSection.parentElement.insertBefore(section, statSection.nextSibling);
    }
    var eb = section.querySelector('#award-edit-btn');
    if (eb) eb.onclick = openEditor;
  }

  function openEditor() {
    var j = cardState;
    if (!j) return;
    var modal = document.createElement('div');
    modal.id = 'award-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';
    var rows = '';
    (j.all || []).forEach(function (r) {
      rows += '<label style="display:flex;gap:6px;align-items:center;padding:4px 0;font-size:13px">'
        + '<input type="checkbox" class="award-hide-cb" data-id="' + esc(r._id) + '"' + (r.hidden ? ' checked' : '') + '>'
        + '<span>[' + esc(r.year) + '] ' + esc(r.contest) + ' ' + esc(r.prize) + '</span></label>';
    });
    if (!rows) rows = '<div style="color:#999;font-size:13px">还没有获奖记录</div>';
    modal.innerHTML = '<div style="background:#fff;border-radius:10px;padding:20px;width:420px;max-width:92vw;max-height:80vh;overflow:auto">'
      + '<h2 style="font-size:16px;margin:0 0 12px">奖项认证设置</h2>'
      + '<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:10px">'
      + '<input type="checkbox" id="award-hide-hook"' + (j.hideHook ? ' checked' : '') + '>'
      + '<span>隐藏用户名旁的奖项钩子</span></label>'
      + '<div style="border-top:1px solid #eee;padding-top:10px;margin-bottom:8px;color:#888;font-size:12px">勾选表示隐藏该奖项(不会删除):</div>'
      + rows
      + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">'
      + '<button class="button" id="award-cancel">取消</button>'
      + '<button class="button primary" id="award-save">保存</button></div></div>';
    document.body.appendChild(modal);
    modal.querySelector('#award-cancel').onclick = function () { modal.remove(); };
    modal.querySelector('#award-save').onclick = function () {
      var hiddenIds = [];
      modal.querySelectorAll('.award-hide-cb').forEach(function (cb) {
        if (cb.checked) hiddenIds.push(cb.getAttribute('data-id'));
      });
      post('/award/hide', {
        uid: j.uid,
        hideHook: modal.querySelector('#award-hide-hook').checked ? 1 : 0,
        hiddenIds: JSON.stringify(hiddenIds),
      }).then(function (ok) { if (ok) location.reload(); });
    };
    modal.onclick = function (e) { if (e.target === modal) modal.remove(); };
  }

  function loadCard() {
    var m = /^\\/user\\/(\\d+)/.exec(location.pathname);
    if (!m) return;
    fetch('/award/user?uid=' + m[1]).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || j.error) return;
      cardState = j;
      renderCard();
    }).catch(function () { });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadCard);
  else loadCard();
})();
`;

class AwardJsHandler extends Handler {
    async get() {
        this.response.type = 'application/javascript';
        this.response.addHeader('Cache-Control', 'no-cache');
        this.response.body = AWARD_JS;
    }
}

class RewardManageHandler extends Handler {
    async get() {
        this.response.addHeader('Cache-Control', 'no-cache');
        if (!isRoot(this.user)) throw new ForbiddenError('仅 root 可访问');
        const settings = await settingColl.find({}).toArray();
        const recordAgg = await recordColl.aggregate([
            { $group: { _id: '$uid', c: { $sum: 1 } } },
        ]).toArray();
        const uids = [...new Set([...settings.map((s) => s.uid), ...recordAgg.map((r) => r._id)])];
        const udict = uids.length ? await UserModel.getList('system', uids) : {};
        const nRecords: Record<number, number> = {};
        recordAgg.forEach((r) => { nRecords[r._id] = r.c; });
        const users = uids.map((uid) => {
            const s = settings.find((i) => i.uid === uid);
            const lv = (s && s.level) || 0;
            return {
                uid,
                uname: (udict[uid] && udict[uid].uname) || String(uid),
                level: lv,
                color: hookColor(lv),
                hideHook: !!(s && s.hideHook),
                nRecords: nRecords[uid] || 0,
            };
        }).sort((a, b) => a.uid - b.uid);
        this.response.body = { users };
        this.response.template = 'reward.html';
    }
}

class RewardRecordsHandler extends Handler {
    async get() {
        this.response.addHeader('Cache-Control', 'no-cache');
        if (!isRoot(this.user)) throw new ForbiddenError('仅 root 可访问');
        const uid = parseInt(String(this.args.uid), 10) || 0;
        if (!uid) throw new ForbiddenError('无效的用户');
        const records = await recordColl.find({ uid }).sort({ year: -1, createAt: -1 }).toArray();
        this.response.body = { uid, records };
    }
}

class RewardSettingSaveHandler extends Handler {
    async post() {
        if (!isRoot(this.user)) throw new ForbiddenError('仅 root 可操作');
        const uid = parseInt(String(this.args.uid), 10) || 0;
        const level = parseInt(String(this.args.level), 10) || 0;
        if (!uid) throw new ForbiddenError('无效的用户');
        if (level < 0 || level > 10) throw new ForbiddenError('等级范围 0-10');
        await settingColl.updateOne({ uid }, { $set: { level } }, { upsert: true });
        this.response.body = { ok: 1 };
    }
}

class RewardRecordSaveHandler extends Handler {
    async post() {
        if (!isRoot(this.user)) throw new ForbiddenError('仅 root 可操作');
        const uid = parseInt(String(this.args.uid), 10) || 0;
        const year = parseInt(String(this.args.year), 10) || new Date().getFullYear();
        const contest = String(this.args.contest || '').trim();
        const prize = String(this.args.prize || '').trim();
        const hidden = String(this.args.hidden) === '1';
        if (!uid) throw new ForbiddenError('无效的用户');
        if (!contest || !prize) throw new ForbiddenError('项目和奖项不能为空');
        const _id = String(this.args._id || '') || nanoid();
        const existing = await recordColl.findOne({ _id });
        if (existing) {
            await recordColl.updateOne({ _id }, { $set: { uid, year, contest, prize, hidden } });
        } else {
            await recordColl.insertOne({ _id, uid, year, contest, prize, hidden, createAt: new Date() });
        }
        this.response.body = { ok: 1 };
    }
}

class RewardRecordDeleteHandler extends Handler {
    async post() {
        if (!isRoot(this.user)) throw new ForbiddenError('仅 root 可操作');
        const _id = String(this.args._id || '');
        if (!_id) throw new ForbiddenError('无效的记录');
        await recordColl.deleteOne({ _id });
        this.response.body = { ok: 1 };
    }
}

class AwardBadgesHandler extends Handler {
    async get() {
        this.response.addHeader('Cache-Control', 'no-cache');
        const settings = await settingColl.find({}).toArray();
        const map: Record<string, any> = {};
        // 仅返回:有认证等级且未隐藏钩子的用户。
        // 是否显示钩子由前端判断——只有该用户名旁实际渲染了自定义 Tag 才注入。
        settings.forEach((s) => {
            if (s.hideHook || !(s.level > 0)) return;
            map[s.uid] = { level: s.level, color: hookColor(s.level) };
        });
        this.response.body = map;
    }
}

class AwardUserHandler extends Handler {
    async get() {
        this.response.addHeader('Cache-Control', 'no-cache');
        const uid = parseInt(String(this.args.uid), 10) || this.user._id;
        if (!uid) throw new ForbiddenError('无效的用户');
        const setting = await settingColl.findOne({ uid });
        const level = (setting && setting.level) || 0;
        const hideHook = !!(setting && setting.hideHook);
        const all = await recordColl.find({ uid }).sort({ year: -1, createAt: -1 }).toArray();
        const canEdit = this.user._id === uid || isRoot(this.user);
        this.response.body = {
            uid, level, hideHook, canEdit,
            records: all.filter((r) => !r.hidden),
            all: canEdit ? all : [],
        };
    }
}

class AwardHideHandler extends Handler {
    async post() {
        if (!this.user._id) throw new ForbiddenError('请先登录');
        const uid = parseInt(String(this.args.uid), 10) || this.user._id;
        if (uid !== this.user._id && !isRoot(this.user)) throw new ForbiddenError('无权限');
        const hideHook = String(this.args.hideHook) === '1';
        await settingColl.updateOne({ uid }, { $set: { hideHook } }, { upsert: true });
        let hiddenIds: string[] = [];
        try {
            hiddenIds = JSON.parse(String(this.args.hiddenIds || '[]'));
        } catch (e) {
            hiddenIds = [];
        }
        await recordColl.updateMany({ uid, _id: { $in: hiddenIds } }, { $set: { hidden: true } });
        await recordColl.updateMany({ uid, _id: { $nin: hiddenIds } }, { $set: { hidden: false } });
        this.response.body = { ok: 1 };
    }
}

export async function apply(ctx: Context) {
    ctx.Route('reward_manage', '/reward', RewardManageHandler);
    ctx.Route('reward_records', '/reward/records', RewardRecordsHandler);
    ctx.Route('reward_setting_save', '/reward/setting/save', RewardSettingSaveHandler);
    ctx.Route('reward_record_save', '/reward/record/save', RewardRecordSaveHandler);
    ctx.Route('reward_record_delete', '/reward/record/delete', RewardRecordDeleteHandler);
    ctx.Route('award_badges', '/award/badges.json', AwardBadgesHandler);
    ctx.Route('award_user', '/award/user', AwardUserHandler);
    ctx.Route('award_hide', '/award/hide', AwardHideHandler);
    ctx.Route('award_js', '/award/award.js', AwardJsHandler);
    await db.ensureIndexes(settingColl, { name: 'uid', key: { uid: 1 }, unique: true });
    await db.ensureIndexes(recordColl, { name: 'uid', key: { uid: 1 } });
}
