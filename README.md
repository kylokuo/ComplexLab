# ComplexLab

呼吸链 Complex I / II / IV 酶活性计算网页原型。

## 运行

```powershell
pnpm install
pnpm dev
```

生产构建：

```powershell
pnpm build
```

## GitHub Pages

仓库地址为 `https://github.com/kylokuo/ComplexLab`，推送到 `main` 或 `master` 分支后，GitHub Actions 会自动构建并部署到：

`https://kylokuo.github.io/ComplexLab/`

首次使用时，在仓库 Settings → Pages → Build and deployment 中将 Source 设置为 `GitHub Actions`。

## 当前输入约定

- 浏览器本地解析 Synergy H1 导出的 `.xlsx` / `.xls` 文件。
- OD 文件需要包含 1–12 列与 A–H 行的 96 孔板矩阵，连续两行视为 Read 1 / Read 2。
- BCA 标准品名称、浓度、上样顺序、复孔数和具体孔位都由用户在 96 孔板上配置；未配置为标准品的孔可继续选择为样品孔。
- BCA 默认标准浓度为 `0、125、250、500、750、1000、1500、2000 μg/mL`，样品浓度结果可导出为 `.xlsx`，包含样品浓度、标准品配置和标准曲线参数三个工作表。
- BCA 样品可编辑样本名并指定对应的 Complex；活性计算表输入或选择相同样本名后，会自动同步对应的 Cpr。
- 活性计算支持批量选择测定孔；Complex I 可为每个测定孔逐行指定唯一对照孔，Complex II / IV 使用空白孔；活性结果可导出为 `.xlsx`，包含结果明细和协议参数。

## 公式来源与实现

公式参数默认来自 `protocol/` 中的 Elabscience 说明书：

- Complex I：`((ΔA对 − ΔA测) × V1 × f × 10⁶) / (ε × d × T × V2 × Cpr)`
- Complex II：`((ΔA测 − ΔA空) × V总 × f × 1000) / (V样 × ε × T × Cpr)`
- Complex IV：`((ΔA测 − ΔA空) × V1 × f) / (V2 × ε × d × T × Cpr)`

当前版本先交付前端原型，尚未加入后端、账号、数据库和服务端持久化。
