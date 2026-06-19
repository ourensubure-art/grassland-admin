# 草地管理决策端

这是给政府 / 合作社领导使用的管理后台。入口保持为单页 HTML，前端通过 Vite 读取 Supabase 环境变量。

## 文件

- `index.html`：登录页、数据总览页、观察列表 / 地图 / 指令下达占位页。
- `src/main.js`：真实 Supabase 数据读取、位置解析、统计和交互。
- `src/lib/supabase.js`：Supabase 客户端初始化。

## 登录

当前是简单硬编码密码，位置在 `src/main.js`：

```js
const ADMIN_PASSWORD = "grassland-admin";
```

## Supabase

Supabase 凭据放在 `.env.local`：

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

`.env.local` 已写入 `.gitignore`，不要提交到仓库。

当前只读取表：

```js
const OBSERVATIONS_TABLE = "observations";
```

当前不会修改表结构，也不会写入数据。

## 本地测试

```bash
npm install
npm run dev
```

然后打开终端输出的本地地址，通常是：

```text
http://localhost:5173/
```

字段探测：

```bash
npm run probe
```

## Vercel 部署

部署时项目根目录选择 `grassland-admin`，并在 Vercel 环境变量里配置：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```
