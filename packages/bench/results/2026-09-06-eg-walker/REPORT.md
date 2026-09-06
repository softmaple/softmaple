# eg-walker 优化与全量 benchmark 对比

2026-09-06。基线为 `3c7e0688b30f5b08bed2c9885771a8e84c39629a`（包版本 1.3.4）；优化版为本次工作区代码。论文 artifact 为 `4d9bef55e4f2e3b3b8b0efe8f91cd35d34ed35a8`。

这次修改解决了字节预算内长并发区间因 4096 事件上限而反复重放的问题，并减少接收事务与线性冷快照校验的开销。收益随场景变化；完整 A2 在原版本和优化版本上均未通过最终文本校验，不计入任何提速结论。

本机实测：4,202 事件逐条离线合并 apply 从 872.04 ms 降至 47.39 ms（18.40×），partial replay 从 103 次降为 0 次；10,000 事件顺序单条接收为 2.05×。完整论文 causal apply 中 C1/C2/A1 分别为 1.16× / 1.39× / 1.07×，S1/S2/S3 基本持平。原有 6 项 Vitest benchmark 均改善，范围 1.16–4.48×。

## 改动

- 并发缓存保留与淘汰统一使用 32 MiB **估算**字节预算，事件索引计入估算。超过 4096 事件的缓存到达单 tip 的 critical cut 后释放；持续并发时可继续复用。字节压力仍会触发释放。
- 对最多 4096 个新事件的闭合事务复用 warm engine；保留批次内 run 合并，最后一次性物化文本。覆盖不足或预算不足时整批回退到一次重放。通用批次的操作结果契约保持一致，失败时回滚 graph、checkpoint、engine、pending 和覆盖索引。
- 已就绪单事件跳过批次拓扑准备和 pending 事务；缺父事件、待处理事件仍走通用入口。checkpoint 及其校验游标采用不可变更新，事务快照共享数组根，避免每次复制 32 个 checkpoint 与 version Set。
- `fromEventGraph` 改为通用批量导入，保留防御性输入处理，没有把通用输入改成严格 causal 契约。
- 冷 portable snapshot 的 exact packed chain 复用原有线性 replay/UTF-16 边界校验；非线性历史仍使用 engine 验证完整文本。增加独立的 snapshot validation replay/event/linear replay 统计，避免被 `fullReplays=0` 掩盖。

## 测量方法

- 本机：v25.9.0，Linux x64，AMD EPYC 9354P 32-Core Processor；CPU quota `400000 100000`，容器内存 8 GiB。共享虚拟化环境，非专用实验机。与审查报告的 Node 24 / Xeon 数据不能直接相除。
- 七套论文数据全部使用 operation 粒度，未设置 `max-events` 或 `max-txns`。每个成功案例分别执行三轮；每轮启动独立进程，版本顺序交替。接收批次固定 4096。首次失败后停止该版本/数据集重复，保留失败记录。
- `apply` lane 使用 causal API，读取/转换包含 builder，apply 单独计时；`persistence` lane 使用原有普通详细接收 harness，并执行 JSON、EGW3、portable snapshot、native snapshot 全部阶段。旧 harness 在普通 lane 的配置行仍打印默认 `applyApi=causal`，但此 lane 的实际调用是 `applyRemoteEvents`，两版一致。两条 lane 的数字不混用。
- 论文表报告三轮中位数；min/max、单轮数据与命令保存在 [summary.json](./summary.json) 和 [full/runs.jsonl](./full/runs.jsonl)。`totalMs` 仅表示读取/转换与 apply；完整进程 wall time 另列，包含启动和全部持久化阶段。
- 正式论文进程顺序执行；没有 profiler。每进程 V8 heap 上限 6656 MiB、超时 600 秒。初始探索日志 `before-paper-apply.log` 不用于正式论文 A/B 表。
- 专项矩阵每个版本独立进程，两次小规模预热后测五轮，显式 GC 在计时外。输入生成和分批切片在计时外；causal builder 单列并计入该轮 total。冷快照始终复制字节，首次编辑包含 lazy graph decode 与完整文本校验。
- RSS 是整进程高水位，包含输入、转换、VM/JIT 和持久化对象，不等于 replay cache。专项 JSON 另有 heapUsed/external/arrayBuffers；external 已包含 arrayBuffers，不能重复相加。旧新 `replayCacheBytes` 的计入项有变化，不用其差值推断实际内存变化。

## 完整论文 apply

| 数据 | 事件数 | apply ms：前 → 后 | 倍数 | 读取+apply ms：前 → 后 | partial replay | 峰值 RSS MiB：前 → 后 |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | 779,334 | 864.37 → 887.42 | 0.97× | 2,111.79 → 2,050.45 | 0 → 0 | 731 → 719 |
| S2 | 1,104,627 | 1,085.24 → 1,084.39 | 1.00× | 2,541.12 → 2,483.39 | 0 → 0 | 905 → 912 |
| S3 | 2,339,471 | 2,273.03 → 2,313.48 | 0.98× | 5,697.24 → 5,390.78 | 0 → 0 | 1,648 → 1,648 |
| C1 | 651,950 | 11,313.43 → 9,751.11 | 1.16× | 12,235.81 → 10,701.09 | 158 → 72 | 1,508 → 1,472 |
| C2 | 608,150 | 14,598.21 → 10,531.92 | 1.39× | 15,589.60 → 11,533.56 | 148 → 63 | 1,508 → 1,565 |
| A1 | 947,337 | 40,645.87 → 38,044.80 | 1.07× | 41,796.49 → 39,223.05 | 30 → 7 | 2,095 → 2,367 |
| A2 | 697,638 | 文本校验失败 | — | — | — | 见失败日志 |

顺序 S1/S2/S3 的 causal apply 基本持平，少量正负变化不构成稳定算法收益。C1/C2/A1 的并发处理有改善，但不能推广为全库十倍提速。A2 完整文本长度均为 227,352 UTF-16 code units，长度一致仍未通过内容校验。

缓存保留也有空间代价：A1 此 lane 的进程 RSS 中位数从 2,095 MiB 增至 2,367 MiB（约 13%），C2 也小幅增加。专项离线负载的 RSS 则明显降低，不能声称所有场景都节省内存。

## 完整持久化阶段

单位均为 ms，`前 → 后` 为分别取中位数。完整进程 wall time 包含 JSON/编码等未单独设 timer 的工作，不能与 `totalMs` 混为一谈。

| 数据 | 普通接收 apply | 读取+apply total | 完整进程 wall | 峰值 RSS MiB | 成功轮数 前/后 |
| --- | --- | --- | --- | --- | --- |
| S1 | 4,184.55 → 4,166.99 | 4,922.28 → 4,912.93 | 28,542.48 → 20,554.43 | 4,279 → 3,593 | 3/3 |
| S2 | 5,164.31 → 5,182.71 | 6,534.10 → 6,500.57 | 39,680.37 → 30,135.37 | 5,108 → 4,486 | 3/3 |
| S3 | 11,025.26 → 11,139.44 | 13,534.44 → 13,587.52 | 124,397.71 → 94,159.21 | 7,122 → 7,045 | 3/3 |
| C1 | 12,448.55 → 10,502.89 | 13,288.79 → 11,348.54 | 39,885.98 → 35,292.83 | 4,131 → 4,149 | 3/3 |
| C2 | 15,923.53 → 11,259.31 | 16,812.49 → 12,134.12 | 42,331.97 → 35,659.44 | 4,109 → 3,955 | 3/3 |
| A1 | 42,303.13 → 40,785.47 | 43,358.91 → 41,782.72 | 75,617.12 → 69,723.33 | 4,473 → 4,468 | 3/3 |
| A2 | — → — | — → — | — → — | — → — | 0/0 |

Portable snapshot：就绪时间按**每轮** decode + restore + materialize 后再取中位数。materialize 包含 EGW3 图解码和历史文本一致性校验，避免仅看 lazy restore。

| 数据 | encode | decode | lazy restore | materialize / validate | 冷物化就绪 |
| --- | --- | --- | --- | --- | --- |
| S1 | 1,501.82 → 1,462.15 | 4.21 → 4.08 | 4.63 → 4.75 | 7,188.19 → 320.59 | 7,196.99 → 329.33 |
| S2 | 1,858.21 → 2,090.85 | 4.56 → 4.38 | 4.32 → 4.31 | 10,332.53 → 265.19 | 10,341.71 → 273.78 |
| S3 | 4,711.16 → 4,647.29 | 1,139.53 → 12.03 | 1.96 → 1,453.14 | 26,903.75 → 425.53 | 28,205.00 → 1,888.72 |
| C1 | 2,324.15 → 2,300.48 | 8.11 → 5.78 | 10.96 → 8.35 | 9,289.16 → 6,333.04 | 9,305.85 → 6,357.47 |
| C2 | 2,228.50 → 2,201.86 | 17.20 → 11.57 | 299.96 → 304.68 | 9,020.87 → 6,514.97 | 9,314.41 → 6,823.80 |
| A1 | 2,584.74 → 2,444.85 | 3.77 → 3.47 | 1.93 → 1.87 | 8,590.67 → 5,531.47 | 8,596.31 → 5,536.85 |
| A2 | — → — | — → — | — → — | — → — | — → — |

S1/S2/S3 的冷物化就绪分别约快 21.85× / 37.77× / 14.93×；整个持久化进程分别约快 1.39× / 1.32× / 1.32×。S3 的 decode/restore 计时受到 GC 落点明显影响，必须合看每轮就绪时间。此次没有改写 native encoder，其阶段耗时变化也可能包含前面阶段造成的堆状态与 GC 差异。

EGW3 图加载与可选 EGWS1 resume state 单列：

| 数据 | EGW3 decode | EGW3 graph load | EGWS1 encode | EGWS1 decode | EGWS1 restore |
| --- | --- | --- | --- | --- | --- |
| S1 | 58.86 → 57.60 | 271.90 → 266.27 | 5,949.23 → 5,030.52 | 144.03 → 148.03 | 29.25 → 29.89 |
| S2 | 66.30 → 67.37 | 184.92 → 180.00 | 7,720.69 → 7,143.50 | 102.51 → 110.81 | 16.02 → 16.40 |
| S3 | 118.45 → 127.58 | 255.77 → 251.97 | 35,550.23 → 35,801.84 | 1,588.99 → 1,532.00 | 16.07 → 16.01 |
| C1 | 336.04 → 375.36 | 1,833.92 → 1,870.65 | 5,563.72 → 5,653.19 | 131.85 → 119.98 | 44.63 → 45.60 |
| C2 | 415.34 → 427.88 | 1,798.77 → 1,762.87 | 5,304.54 → 5,321.72 | 109.69 → 119.83 | 39.46 → 38.99 |
| A1 | 273.47 → 310.85 | 1,751.49 → 1,726.42 | 8,707.80 → 8,250.77 | 26.93 → 26.36 | 3.79 → 3.79 |
| A2 | — → — | — → — | — → — | — → — | — → — |

存储大小（bytes；相同值只写一次）：

| 数据 | JSON | EGW3 | portable EGWP1 | native EGWS1 |
| --- | --- | --- | --- | --- |
| S1 | 151,730,995 | 2,651,528 | 2,978,498 | 4,958,160 |
| S2 | 215,257,606 | 3,753,748 | 3,926,463 | 1,683,541 |
| S3 | 458,888,557 | 7,730,090 | 7,855,316 | 2,896,022 |
| C1 | 128,648,935 | 10,993,438 | 11,530,876 | 1,885,841 |
| C2 | 122,013,768 | 15,397,845 | 15,930,858 | 2,369,333 |
| A1 | 179,912,080 | 3,174,915 | 3,214,672 | 474,371 |
| A2 | — | — | — | — |

## 原有 Vitest bench 全量结果

全部 5 个 `.bench.ts` 文件、6 个 benchmark（checkpoint 含两条路径）。单位 ms，使用 Vitest 导出的 median；均值、RME 和 sampleCount 保留在原始 JSON。该 lane 使用 Vitest 自适应采样，不与下方固定五轮专项混算。

| 场景 | 优化前 | 优化后 | 倍数 | 样本数 前/后 |
| --- | --- | --- | --- | --- |
| checkpoint-effectiveness / incremental: applyRemoteEvent per event (checkpoint-aware) | 0.689 | 0.204 | 3.38× | 511/1718 |
| checkpoint-effectiveness / batch-from-graph: single cold-start fullReplay | 0.401 | 0.347 | 1.16× | 1052/1291 |
| concurrent-same-index-inserts / apply 200 concurrent inserts at index 0 | 2.031 | 1.278 | 1.59× | 180/311 |
| delete-heavy-workload / apply 2000 delete-heavy events (~70% deletes) | 12.501 | 2.792 | 4.48× | 39/138 |
| long-linear-history / apply 5000 sequential inserts to a fresh replica | 34.181 | 12.130 | 2.82× | 15/40 |
| long-offline-branch-merge / apply 2 branches of 1000 events each, then merge | 23.864 | 10.041 | 2.38× | 21/37 |

## 固定五轮专项矩阵

以下全部为每轮结果的中位数，单位 ms。通常 total = builder + apply + 最终文本物化；snapshot total 另包含 decode + restore + first edit。每个案例所有轮次及两版的最终文本 SHA-256 必须一致。线性、删除与 offline 轨迹还校验独立预期字符串；其余并发案例的哈希一致不代表独立 oracle 认证。

| 场景 / 批次 / API | apply 前 → 后 | builder 前 → 后 | total 前 → 后 | total 倍数 | full/partial 前 → 后 |
| --- | --- | --- | --- | --- | --- |
| checkpoint-1-detailed | 2.06 → 1.28 | 0.00 → 0.00 | 2.06 → 1.28 | 1.61× | 0/1 → 0/1 |
| concurrent-1-detailed | 6.22 → 7.15 | 0.00 → 0.00 | 6.23 → 7.15 | 0.87× | 1/0 → 1/0 |
| delete-1-detailed | 20.73 → 6.01 | 0.00 → 0.00 | 20.74 → 6.01 | 3.45× | 0/0 → 0/0 |
| linear-1-detailed | 84.60 → 41.25 | 0.00 → 0.00 | 84.62 → 41.27 | 2.05× | 0/0 → 0/0 |
| linear-10000-import | 84.31 → 40.69 | 0.00 → 0.00 | 84.33 → 40.70 | 2.07× | 0/0 → 0/0 |
| linear-4096-causal | 5.76 → 6.67 | 8.11 → 8.97 | 12.59 → 14.07 | 0.89× | 0/0 → 0/0 |
| linear-4096-detailed | 37.02 → 40.79 | 0.00 → 0.00 | 37.04 → 40.81 | 0.91× | 0/0 → 0/0 |
| linear-5000-1-detailed | 49.23 → 21.77 | 0.00 → 0.00 | 49.25 → 21.78 | 2.26× | 0/0 → 0/0 |
| linear-64-detailed | 35.50 → 34.10 | 0.00 → 0.00 | 35.52 → 34.12 | 1.04× | 0/0 → 0/0 |
| offline-1000-1-detailed | 29.70 → 21.99 | 0.00 → 0.00 | 29.71 → 21.99 | 1.35× | 1/0 → 1/0 |
| offline-2000-1-detailed | 64.60 → 37.76 | 0.00 → 0.00 | 64.62 → 37.78 | 1.71× | 1/0 → 1/0 |
| offline-2000-4096-detailed | 32.36 → 32.48 | 0.00 → 0.00 | 32.37 → 32.49 | 1.00× | 1/0 → 1/0 |
| offline-2000-64-detailed | 245.93 → 29.55 | 0.00 → 0.00 | 245.94 → 29.56 | 8.32× | 1/31 → 1/0 |
| offline-2100-1-detailed | 872.04 → 47.39 | 0.00 → 0.00 | 872.05 → 47.40 | 18.40× | 1/103 → 1/0 |
| offline-2100-4096-detailed | 56.22 → 46.26 | 0.00 → 0.00 | 56.23 → 46.29 | 1.21× | 1/1 → 1/0 |
| offline-2100-64-detailed | 269.12 → 29.75 | 0.00 → 0.00 | 269.13 → 29.76 | 9.04× | 1/33 → 1/0 |

| 冷快照 / 首次操作 | decode 前 → 后 | restore 前 → 后 | first edit 前 → 后 | total 前 → 后 | total 倍数 | 优化后 validation events |
| --- | --- | --- | --- | --- | --- | --- |
| linear-1-snapshot-local | 0.12 → 0.08 | 0.11 → 0.10 | 32.72 → 4.61 | 33.38 → 4.79 | 6.97× | 10000 |
| linear-1-snapshot-remote | 0.09 → 0.09 | 0.10 → 0.10 | 78.48 → 62.88 | 78.69 → 63.08 | 1.25× | 10000 |
| offline-2100-1-snapshot-local | 0.07 → 0.07 | 0.05 → 0.06 | 28.14 → 17.76 | 28.27 → 17.93 | 1.58× | 4202 |
| offline-2100-1-snapshot-remote | 0.06 → 0.07 | 0.05 → 0.06 | 67.02 → 58.98 | 67.15 → 59.12 | 1.14× | 4202 |

专项进程峰值 RSS（包含预热和五轮，取进程高水位的最大值）：

| 专项 | RSS MiB 前 → 后 |
| --- | --- |
| linear-1-detailed | 208.1 → 131.9 |
| linear-1-snapshot-local | 108.4 → 89.6 |
| offline-2100-1-detailed | 357.7 → 154.7 |
| offline-2100-64-detailed | 279.6 → 136.7 |

### 小负载的补充复测

原始五轮矩阵中，200 并发事件和两项 4096 批次顺序接收分别出现 0.87× / 0.91× / 0.89×。保留这些结果，并为每项另启三组前后进程、交替版本顺序，每进程仍测五轮。以下为各进程 total 中位数，单位 ms；不替换上面的初测值。命令及全部样本见 [focused-followup](./focused-followup/commands.json)。

| 场景 | 优化前，三个进程 | 优化后，三个进程 |
| --- | --- | --- |
| concurrent-1-detailed | 6.52 / 4.29 / 5.65 | 4.63 / 4.37 / 5.05 |
| linear-4096-detailed | 38.38 / 38.21 / 36.14 | 34.50 / 39.87 / 35.07 |
| linear-4096-causal | 11.67 / 11.09 / 14.46 | 11.68 / 10.43 / 11.13 |

复测未重现一致的退化方向，短进程内还存在明显的 JIT 预热趋势。这三项不能仅凭初测的单个进程中位数认定稳定回退，也不足以报告稳定提速。

## 失败与限制

- `apply-A2-before-1`：退出状态 1，进程 wall 312.32 s；A2: final text mismatch, got 227352 UTF-16 code units, expected 227352。见 [apply-A2-before-1.log](./full/apply-A2-before-1.log)。
- `apply-A2-after-1`：退出状态 1，进程 wall 262.18 s；A2: final text mismatch, got 227352 UTF-16 code units, expected 227352。见 [apply-A2-after-1.log](./full/apply-A2-after-1.log)。
- `persistence-A2-before-1`：退出状态 1，进程 wall 331.09 s；A2: final text mismatch, got 227352 UTF-16 code units, expected 227352。见 [persistence-A2-before-1.log](./full/persistence-A2-before-1.log)。
- `persistence-A2-after-1`：退出状态 1，进程 wall 281.90 s；A2: final text mismatch, got 227352 UTF-16 code units, expected 227352。见 [persistence-A2-after-1.log](./full/persistence-A2-after-1.log)。

- A2 额外使用一次整批接收诊断：两版输出 SHA-256 均为 `3a4da13d6f7ead4357d1a93fec2f6cf58f7a2cbb50aef742c163caef64ed455c`，预期为 `679d80c2a145ef919b733a0587702872dddfc5c2c763d9e312507be6951a37b7`，首个差异在 UTF-16 offset 27,800。该问题在基线及整批路径已存在，根因尚未定位。见 [原版诊断](./a2-diagnostic-before.log)、[优化版诊断](./a2-diagnostic-after.log)。诊断构建只增加失败文本信息，其耗时不用于性能比较。
- 32 MiB 是 replay cache 的估算预算，不是整个进程内存上限；并发区间本身超过预算后仍可能重放。当前实现没有压实 object tail，也没有实现 block-model 增量事务。
- 这些局部收益不可相乘，也不能换算成整个编辑器的速度。此次没有测 Lexical、浏览器渲染、应用事务端到端时间或论文 Rust 实现。

## 验证与复现

- `@softmaple/eg-walker`：92 个测试文件，743 个测试通过；包含新增长并发阈值、Unicode 删除/乱序、缓存字节压力、原子回滚与冷快照校验测试。
- pinned reference conformance：2 个测试通过；1000 条官方轨迹 × canonical/padded 两种 ID，通用引擎与 packed restore 均逐条核对。
- `@softmaple/bench`：8 个文件、44 个测试通过；调用方 `@softmaple/block-model`：2 个文件、28 个测试通过。类型检查与构建通过，ESLint 无 error（原有 warning 保留）。详见 [validation.log](./validation.log) 和 [validation.json](./validation.json)。
- 所有实际命令和退出状态见 [full/runs.jsonl](./full/runs.jsonl)。环境见 [environment.json](./environment.json)，构建与源码 SHA-256 见 [checksums.json](./checksums.json)。
- 运行方法见 [bench README](../../README.md#replay-optimization-ab-workers)。`compare-paper-bench.mjs`、`compare-replay-bench.mjs` 顺序运行独立的 before/after bundle；`summarize-replay-comparison.mjs` 从原始日志重新生成 `summary.json`。
