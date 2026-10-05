# hydro-award

洛谷风格**奖项认证**插件。

## 功能

- **用户名旁奖项钩子(全站)** — 用户名右侧(用户名 → Tag → 钩子)显示洛谷同款 badge-check 图标
  (白色对勾 + 等级颜色底),悬停显示"奖项认证:N 级"。
- **用户中心卡片** — `/user/:uid` 右侧统计卡片下方:
  - 第一行:`奖项认证:N 级 [钩子图标]`
  - 第二行起:`[年份] 比赛 等级`,如 `[2025] CSP-J 一等奖`
- **隐私控制** — 本人点卡片"编辑"可隐藏用户名旁钩子或单条奖项(仅隐藏不删除)。
- **管理页 `/reward`(仅 root)** — 用户列表表格:`UID | 用户名 | 奖项认证等级 | 获奖记录(查看)`。
  点"查看"弹出弹窗:可修改认证等级(0-10)、逐条修改/隐藏/删除获奖记录、添加新记录。
  也可用顶部表单直接给新用户设定等级。

## 等级与颜色(固定规则)

认证等级由**管理员直接设定**(0-10),与获奖记录无关;获奖记录由管理员导入管理。

| 等级 | 颜色 |
|---|---|
| 1 ~ 2 级 | `#BFBFBF` 灰色 |
| 3 ~ 5 级 | `#52c41a` 绿色 |
| 6 ~ 7 级 | `#3498db` 蓝色 |
| 8 ~ 10 级 | `#ffc116` 金色 |

## 数据模型

- `award.setting` `{ uid, level(0-10), hideHook }` — 认证等级 + 钩子开关
- `award.record` `{ _id, uid, year, contest, prize, hidden, createAt }` — 获奖记录

## 安装

```bash
mkdir -p /root/.hydro/addons
mv /home/ubuntu/hydro-award /root/.hydro/addons/
hydrooj addon add /root/.hydro/addons/hydro-award
pm2 restart hydrooj
```

## 注意事项

- **覆盖官方模板** `layout/basic.html`(仅追加一行 `<script src="/award/award.js">`)。
  升级 Hydro 大版本后需检查该文件是否需要同步。
- API:`GET /award/badges.json`(公开)、`GET /award/user?uid=`(公开)、`POST /award/hide`(本人/root)、
  `/reward*` 全部仅 root。
