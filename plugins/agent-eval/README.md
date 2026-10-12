# Agent evaluation plugin

可复用的评估源码插件，使用 Python 标准库和选定 Owner 的公开调用入口。
现有 Claude Code 评估器、场景、CLI 控制器与回归已从 Rho-core 迁入本目录。
Core 运行库和普通 Cargo 检查不依赖本插件。当前直接调用脚本；没有新 Core
装载协议、旧 protocol-v1 包适配或应用安装接入。

## 入口与复用

在 Rho-plugins 根目录运行；也可使用脚本的绝对路径。输出目录必须是新目录，
默认在本仓 `target/agent-evals/<UTC时间>/`。程序不覆盖原评估报告。

```sh
# 使用一个显式选择的公共 Core 二进制；不读取 Core 源码或构建目录。
python3 plugins/agent-eval/run.py core-agent --binary /absolute/rho-core --baseline --trials 1
python3 plugins/agent-eval/run.py core-agent --binary /absolute/rho-core --case execute --trials 1

# 在原产物上调用领域 Owner 的独立核验器；不调用模型、不重跑 R 分析。
python3 plugins/agent-eval/run.py r-artifacts /absolute/airway/artifacts

# 保留原判定，对原 Agent 证据离线重评分。
python3 plugins/agent-eval/run.py core-agent --regrade /absolute/original/agent-evidence

# 其他领域用普通 JSON 用例和可执行核验脚本复用同一入口。
python3 plugins/agent-eval/run.py check --case /absolute/check-case.json --output /absolute/new/evidence
```

通用用例示例（命令不用 shell 解析，路径建议为绝对路径）：

```json
{
  "id": "domain-result",
  "scope": "The domain Owner's selected result checks",
  "command": ["python3", "/absolute/owner/verify.py", "/absolute/artifacts", "--report", "{report}"],
  "identity_files": ["/absolute/artifacts/complete.json"],
  "not_scored": ["Agent autonomy", "Scientific generalization"]
}
```

`{report}` 必须是唯一独立参数，由入口替换为新的 `owner-report.json` 路径。
核验器写 JSON 对象，其中 `passed` 为布尔值，可带自己的 `checks` 和限制。
领域判断留在 Owner；入口不导入其私有实现，不将不同领域折合成统一质量分数。
命令、用例和报告不能包含凭据；认证由原工具环境承担，入口不采集完整环境。
普通用例不构成 OS 沙箱；只有自有核验器进程组被启动和清理。

## 证据与资源边界

`core-agent` 的模型、权限、八场景、结构化报告、输出限额和未评分范围见
[消费者说明](core-agent/README.md)。`--binary` 或 `RHO_EVAL_CORE_BINARY`／PATH
选定实际公共二进制，其 SHA-256 与每次从该二进制取得的契约保存到证据。
库夹具仅在显式选择 `--transport fixture --fixture-binary /absolute/eval_fixture`
时使用；CLI 模式不要求该夹具或 Rust 工具链。

`check` 与 `r-artifacts` 保留用例、执行脚本摘要、输入身份文件摘要、原 Owner 报告、
原 stdout/stderr、退出码、异常、每轮判定及汇总。报告区分检查范围与未评分项。
核验前后比较声明的身份文件；身份变化、Owner 失败、非零退出、超时或缺失／损坏
报告都失败。R 的完整性、配对和独立算术仍由
[R 核验器](../../examples/real-r-analysis/verify.py)定义，不独立拟合 DESeq2或读取 RDS。
这条入口核验已有产物，不补造其旧操作来源，不证明模型自主完成研究。

通用核验默认 1 次，`--trials` 可选 1..20；每次时限默认 180 秒，`--timeout`
可选 .01..600 秒；每次合计 stdout/stderr 保留默认 8 MiB，
`--max-output-bytes` 可选 1 KiB..64 MiB，Owner JSON 的可读上限使用同一值。
超限保留有界输出和失败报告，停止本次核验器进程组。核验器自行写的其他文件、
科学输入内存和磁盘使用仍由实际 Owner 控制；这里不是磁盘或全环境配额。
中断保留部分材料和原计划分母，未运行试次明确列出。重复检查使用新证据目录。

## 验证与当前范围

```sh
python3 -m unittest discover -s plugins/agent-eval -p 'test_*.py' -v
RHO_EVAL_CORE_BINARY=/absolute/rho-core python3 -m unittest discover -s plugins/agent-eval/core-agent -p 'test_*.py' -v
```

两组回归分别覆盖共用 Owner 核验入口和迁入的 Core CLI／评分器；不调用模型。
实际迁移验收见 [ACCEPTANCE](ACCEPTANCE.md)。原模型失败和旧证据保留在原目录。
此次完成评估器迁移与两个消费者复用；候选补丁比较、Git 回退、盲测管理及自动
hillclimb 尚未实现，也未将过去的 15/16 解释为全部 Agent 可靠。
