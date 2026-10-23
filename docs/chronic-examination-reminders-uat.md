# 慢病检查检验提醒一期验收

## 交付范围

慢病复诊配药结果读取与 getJYJCPro 同源的 getUserInfo 健康处方推荐，结合 PHIS 近90天返回的已出报告，匹配本次实时可开立目录，默认未选；医生在现有卡片选择后随所选病历、诊断和药品统一回写。随访核查选项继续增量写入现病史，监测建议通过注意事项回写。

健康大脑全区历史 Provider 仅预留，固定 not_connected；推荐源已接入 getUserInfo。按当前交互要求，提醒区及明细浮层均移除固定的“PHIS 近90天……健康大脑全区查询未接入”来源提示，实际查询失败和历史不完整状态仍直接显示。既不把年度推荐推断为本次必做，也不把未查到同名报告推断为未检查；报告日期当前只提供申请时间时必须标作申请时间。未出报告的申请状态本期未纳入完成情况判定，开立前由医生结合 PHIS 当前申请核对。

## 服务端配置

部署 PCIE Server 与配套桌面端代码，按环境配置：

```sh
FB_CHRONIC_EXAMINATIONS_ENABLED=true
FB_CHRONIC_EXAMINATIONS_BASE_URL=https://health-prescription.example
FB_CHRONIC_EXAMINATIONS_AK=<由现场安全注入>
FB_CHRONIC_EXAMINATIONS_SK=<由现场安全注入>
FB_CHRONIC_EXAMINATIONS_CONNECT_TIMEOUT_MS=3000
FB_CHRONIC_EXAMINATIONS_READ_TIMEOUT_MS=8000
```

根地址和 AK/SK 放在对应环境私有 service.env，属运行用户、权限600，变更前备份；不提交实际值。服务端直接登录并对 getUserInfo 请求/响应进行 SM4 加解密，客户端只调用原有签名接口。AK/SK 不进入桌面端或 bootstrap。内网 HTTP 与 host 按既有出站安全配置允许。默认关闭；源不可用与合法空推荐明确区分，不阻塞既有慢病药品和病历回写。全区90天明细 Provider 仍未接入。

## 自动化覆盖

- 签名 regional 真实传输路径、完整患者/就诊身份、合法空、错误及结构异常。
- 服务端 DeviceAuthFilter 与真实 ECDSA 测试：无令牌、无签名、签名正文篡改被拒绝；缺失身份被校验。
- 上游 HMAC 签名、SM4 加解密、token 缓存/失效与加密请求体、只返回中性推荐、禁用/错误与空结果区分；已知 Mock 与跨患者身份拒绝。
- PHIS 历史列表失败/详情缺失的覆盖状态、完整90天窗口、排除当前就诊与过期记录、同名不同类型过滤。
- 目录只用本次实时结果，名称歧义/受限项目/未匹配无自动医嘱；组合不拆单，重复推荐不重复开立。
- 保留目录 ID、执行科室、部位、检验组合和互认编码，默认未选；医生选择后同一 record-confirmed batch 携带所选病历与医嘱，未选不提交。
- 结果患者/就诊/机会切换，以及 HIS 机构/租户/科室变化时，迟到推荐不能提交到新上下文。
- Vue 组件实际挂载验证范围、空态/失败态、申请时间标注和原文文本安全。

## 真实 Tauri / PHIS 联调（待现场执行）

1. 使用测试环境真实患者，从 PHIS 接诊，核对当前 idPi、idVis、机构/科室与身份证。确认 getUserInfo 返回推荐属于同一患者且为真实数据。
2. 确认慢病范围后立即显示原有病历核心；推荐查询与慢病单次模型流并行。模型请求数保持一次，源失败不得追加模型或通用四路治疗。
3. 核对90天内不同就诊/不同疾病下的同名报告均可作为事实参考；当前就诊和窗口外记录不混入；默认不勾选，已出报告也不自动阻止医生复查。
4. 勾选已匹配检验与检查，核对部位、执行科室、检验组合；选择随访参考、编辑注意事项，执行一次一键回写，抓取一条 batch 并核对 PHIS 草稿与医嘱。取消勾选的项目不得进入 orderList，未选病历字段不得覆盖 PHIS 原内容。
5. PHIS 返回互认 pending 时保留等待，使用原 requestId 决策，最终成功/失败/取消后再收口；不得创建第二条首轮 record-confirmed。
6. 切换患者/就诊、重新接诊、切换科室时模拟慢响应；旧推荐和旧目录不得回填。
7. 断开上游、缺少身份证、返回合法空数组、目录失败及部分历史详情失败，分别核对文案和现有药品回写仍可完成。
8. 明确显示全区查询未接入；不得宣称已核对全区或已完成年度任务。

本地浏览器与自动测试只使用合成资料。未执行真实 Tauri/内网联调，不宣称正式临床验收通过。

## 初版验证记录（本轮直接鉴权验证见末节）

- `yarn type-check`：通过；`yarn build`：通过（含 vue-tsc）。
- `yarn test:unit`：199 文件、1266 测试通过。
- `cargo check --locked --manifest-path src-tauri/Cargo.toml`：通过。
- PCIE Server `mvn -f server/pom.xml clean test`：505 测试，0失败/错误、1既有跳过。包含管理端构建。
- ego-browser 挂载实际提醒 Vue 组件，以合成数据核对推荐/近期报告、长名称、失败与历史不完整展示；没有调用真实患者/上游接口。
- 真实 Tauri、PHIS 医嘱保存/回执/互认及 rbmh-cdw 内网查询未执行；需按上文清单在现场验收。
- 工作区引用的 `../TESTING_STRATEGY.md` 当前不存在，已按 AGENTS 门禁和本清单补足签名、状态、隔离、回写及现场验证项。

## 源码调用链核查

rbmh-cdw 的 HttpClientUtils.doPost4urlencoded 忽略传入 URL，实际使用自身 AlUrl 常量，并包装 SM4 加密的 content/token；响应 data 使用同一 SK 解密。HmacSha1Util 负责 HMAC-SHA1 登录，原系统凭据来自 HealthRecipeMapper 对应数据库。页面直接展示 inspectionItems[].inspectResult。本期服务端直接复用该底层真实协议，避免旧 facade 在 alibaba.open 关闭时返回固定 Mock。全区90天明细仍无独立契约，继续标记未接入。

## 直接鉴权查询验收（本轮）

接入健康处方 `/api/login` 与 `/api/wjjbgs/cy/getUserInfo`，复用两慢病的 HMAC-SHA1 + SM4 协议。采用 [Bouncy Castle Java 8 密码实现](https://www.bouncycastle.org/download/bouncy-castle-java/)。测试患者标识仅在受保护测试输入中使用，不在仓库记录。接口一致性需核对返回 inspectionItems 的数量、顺序与 inspectResult；截图是否为同患者尚待确认，不能仅凭名称相似宣称同患者页面一致。


2026-10-20（本机时区）在智医服务器以 Java 8 执行本次编译的真实 HealthPrescriptionClient + ChronicExaminationService，读取测试环境私有配置，通过登录、加密查询和解密规范化；首次与重复 service 查询结果一致。未执行 PHIS 病历/医嘱写入，未重启或替换现有服务。测试 service.env 已配置、原文件已备份，权限600；实际凭据不在仓库。

返回 inspectionItems 为数组，共17项；规范化后仍17项，顺序保留：

胰岛素释放试验、尿肾功能、颈动脉B超、餐后二小时血糖、腹部B超、C肽释放试验、下肢血管B超、葡萄糖耐量试验、四肢多普勒、足背动脉搏动、血脂、周围神经检查、同型半胱氨酸、空腹血糖、心电图、眼底检查、糖化血红蛋白。

截图可见18项：其中“肾功能”“X线胸片”未在本次患者响应中出现；本次响应新增“心电图”，其余16项名称与相对顺序一致。截图出生年份与提供的测试标识年份不同，不能宣称同患者一致，仍需在两慢病系统打开该测试患者页面做最终核对。源码已确认页面直接展示 inspectionItems[].inspectResult，无额外本地推荐计算。

健康处方查询成功只验证推荐来源，不代表健康大脑全区90天报告明细已接入，regionalHistory.status 仍为 not_connected。桌面正式发布、真实 Tauri/PHIS 勾选回写与互认回执仍按前述清单独立验收。

本轮最终自动化验证：`yarn type-check`、`yarn build`、`cargo check --locked --manifest-path src-tauri/Cargo.toml` 均通过；`yarn test:unit` 199文件、1267测试通过；PCIE Server `mvn -f server/pom.xml clean test` 522测试，0失败/错误、1既有跳过（含管理端构建）。新增10项协议测试覆盖独立密码向量、加密报文、token 复用/过期/凭据轮换/并发单次登录、鉴权重试上限、业务错误、非法密文与 TRACE 日志不泄露。

## 三项受控对照与紧凑提醒（2026-10-22）

仅添加糖化血红蛋白/糖化血红蛋白测定、同型半胱氨酸/血同型半胱氨酸测定、心电图/常规心电图/常规心电图检查/常规心电图检查费的固定完整名称关系。必须同类别、所有同义候选共同唯一；两项检验只接纳明确非组套0/false的目录项，不明确、1/2/true、元数据冲突均保留歧义提示。未解析部位、多部位/科室候选、受限项目与带未批准修饰名称不自动匹配。保留实时ID、LIS分类、执行科室、部位与互认编码，默认不勾选。

验证清单：覆盖原名与别名并存、同名组套+单项、唯一但组套未确认、错误类别、未知/冲突元数据、扩展/动态心电图排除、历史同义词与类型隔离、实际选择后一次batch回写；提示图标初始无明细DOM、悬浮/聚焦/点击可读、可移动到浮层并滚动、Escape/外部点击/结果切换关闭、长列表和窗口边缘不截断、原文XSS安全、源失败/零命中/历史不完整直接可见。浏览器只用合成目录，不执行真实医嘱写入。

本轮验证：`yarn type-check` 与 `yarn build` 通过；`yarn test:unit` 203文件、1307项通过。匹配/Builder/组件专项32项覆盖三项对照、跨目录不命中、别名与原名共同歧义、未知/冲突组套、部位缺失、推荐子项合并、历史名称族和医生选择后的真实目录ID回写。ego-browser 实际挂载生产 Builder/提醒组件，以合成目录验证三项候选默认未选、歧义仅保留提醒、图标可见、悬浮移入与列表滚动、键盘 Enter/Escape/焦点恢复、源失败和结果切换、1100×780窗口边缘定位。合成预览见 `output/chronic-reminder-runtime-20261022/HARNESS.md`，本地 `compact.png / details.png` 为移除固定来源提示前的交互验收截图，不随代码提交。未执行真实 Tauri/PHIS 开立或回执联调，本轮未改服务端和数据库。

固定来源提示移除后再次执行 `yarn type-check`、`yarn test:unit`（203文件、1307项）与 `yarn build` 均通过；组件断言覆盖常驻区和明细浮层均无旧来源提示，并保留查询失败/不完整状态。
