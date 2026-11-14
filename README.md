# 拼豆图纸助手

拼豆图纸分享网站：前台浏览/搜索/收藏/投稿 + 管理后台，Node.js + Express + SQLite。

## 快速启动

双击 `启动.bat`，或在终端运行：

```
node server.js                 # 网站 -> http://127.0.0.1:3000
ngrok.exe start pindou-web --config ngrok.yml   # 固定公网地址
```

## 固定公网地址

**https://gating-womanly-overbook.ngrok-free.dev**（ngrok 免费固定域名，重启不变）

## 24 小时在线部署到 Render(免费,免绑卡)

本机部署时电脑关机网站就停。要 24 小时在线,把网站部署到 Render 免费云主机:

1. 把项目上传到 GitHub 仓库(根目录需包含 `render.yaml`)
2. 打开 Render 控制台 → New + → Blueprint → 连接 GitHub 选择该仓库 → Apply
3. 自动创建 Web 服务(pindou) + Postgres 数据库(pindou-db),完成即可

- 云端使用 Postgres(`DATABASE_URL`),本地仍用 SQLite(`data/pindou.db`),代码自动切换
- 云端上传的图片/字体/收款码存数据库 blob,重启不丢
- 得到固定地址 `https://pindou.onrender.com`(可在 Render 里改)

## 管理员账号

- 用户名：`admin`　密码：`admin123`（UID 000000000001）
- **请登录后台后立即在「用户管理 → 改密码」修改默认密码**

## 功能清单

前台：
- 图纸浏览、分类筛选（分类带图标）、名称/描述搜索（大小写不敏感）
- 图纸详情：高清原图 / 像素网格两种视图，悬停显示 MARD 色号
- 登录后评论（显示 UID、用户名、时间）、1-5 星评分（星星图片可后台替换）
- 收藏、金币右上角显示、投稿（待审核）、金币商店（订单/激活码/优惠码）

后台（`/admin`）：
- 数据概览、图纸管理（审核/编辑/删除）、分类管理（上传图标）
- 用户管理（新增账号、改密码、加金币、封禁、CSV 导出带 BOM）
- 评论管理、封禁管理（封 IP/封 UID，小时/天/永久，自动防护：同 IP 失败 8 次或同账号失败 10 次（10 分钟内）自动封 2 小时）
- 公告管理、金币订单审核、优惠码/激活码、主题设置（主色调、封面背景、TTF 字体上传、星星/金币图标、收款码）、维护模式

## 目录结构

```
server.js          服务器入口(会话/安全中间件/上传/路由)
db.js              SQLite 建库(UID 从 1 递增 = 12 位 000000000001)
settings.js        站点设置
util.js            封禁/防护/UID 工具
routes-public.js   前台 API
routes-admin.js    后台 API
uploads.js         base64 上传
views/             页面(前台+后台)
public/assets/     样式/脚本/图标/字体/星星/金币图标
```
