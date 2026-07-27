import type { ReadWeaveGenerateRequest, ReadWeaveGenerateResponse } from "@triliumnext/commons";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
    findReadWeaveQualityIssues,
    generateReadWeaveAnswer
} from "./readweave_ai.js";
import { searchReadWeaveEvidence } from "./readweave_search.js";

const describeBenchmark = process.env.READWEAVE_BENCHMARK_AI === "1" ? describe : describe.skip;

type BenchmarkDomain =
    | "electronic-design"
    | "medicine"
    | "law"
    | "finance"
    | "statistics"
    | "physics"
    | "biology"
    | "climate"
    | "history"
    | "humanities"
    | "software"
    | "networking"
    | "economics"
    | "language"
    | "astronomy"
    | "cybersecurity"
    | "databases"
    | "artificial-intelligence"
    | "chemistry"
    | "control"
    | "mathematics"
    | "mechanical-engineering"
    | "geospatial"
    | "psychology"
    | "music"
    | "public-health";

type BenchmarkStyle =
    | "technical-note"
    | "paper"
    | "textbook"
    | "news"
    | "manual"
    | "specification"
    | "dialogue"
    | "noisy-note"
    | "bilingual"
    | "table"
    | "argument";

interface BenchmarkCase {
    name: string;
    group: "definition" | "explanation" | "quantitative" | "boundary";
    domain?: BenchmarkDomain;
    style?: BenchmarkStyle;
    request: ReadWeaveGenerateRequest;
    expected: RegExp[];
    forbidden?: RegExp[];
}

interface GenerationObservation {
    name: string;
    group: BenchmarkCase["group"];
    domain: BenchmarkDomain;
    style: BenchmarkStyle;
    repetition: number;
    accepted: boolean;
    semanticPass: boolean;
    formatPass: boolean;
    latencyMs: number;
    costCny: number;
    totalTokens: number;
    modelCalls: number;
    contextCharacters: number;
    body?: string;
    termIdentity?: ReadWeaveGenerateResponse["termIdentity"];
    qualityIssues?: string[];
    missingExpected?: string[];
    matchedForbidden?: string[];
    error?: string;
}

function diverse(testCase: BenchmarkCase, domain: BenchmarkDomain, style: BenchmarkStyle): BenchmarkCase {
    return { ...testCase, domain, style };
}

function term(name: string, title: string, selected: string, expected: RegExp[], forbidden?: RegExp[]): BenchmarkCase {
    return {
        name,
        group: "definition",
        request: {
            articleId: "readweave-balance-benchmark",
            anchorId: `term-${name}`,
            anchorType: "range",
            kind: "term",
            title,
            fragments: [ { id: "selected", role: "selected", text: selected } ]
        },
        expected,
        forbidden
    };
}

function question(
    name: string,
    group: BenchmarkCase["group"],
    title: string,
    selected: string,
    expected: RegExp[],
    forbidden?: RegExp[]
): BenchmarkCase {
    return {
        name,
        group,
        request: {
            articleId: "readweave-balance-benchmark",
            anchorId: `question-${name}`,
            anchorType: "range",
            kind: "question",
            title,
            fragments: [ { id: "selected", role: "selected", text: selected } ]
        },
        expected,
        forbidden
    };
}

const CASES: BenchmarkCase[] = [
    term("cpu", "CPU", "CPU 执行通用程序指令，并通过控制、算术逻辑与缓存等部件完成计算。", [ /CPU 中央处理器（Central Processing Unit）/u, /指令|通用/u ]),
    term("gpu", "GPU", "GPU 通过大量并行执行单元处理图形与数据并行工作负载。", [ /GPU 图形处理器（Graphics Processing Unit）/u, /并行/u ]),
    term("tpu", "TPU", "TPU 是面向张量运算和机器学习工作负载的专用加速处理单元。", [ /TPU 张量处理单元（Tensor Processing Unit）/u, /张量|机器学习/u ]),
    term("fpga", "FPGA", "FPGA 的逻辑功能与互连可以在制造后重新配置，用于实现定制数字电路。", [ /FPGA 现场可编程门阵列（Field-Programmable Gate Array）/u, /重新配置|可编程/u ]),
    term("soc", "SoC", "SoC 在单个芯片上集成处理器、存储控制器、互连与专用外设模块。", [ /SoC 片上系统（System on Chip）/u, /集成/u ]),
    term("noc", "NoC", "NoC 以路由器和链路连接片上多个计算与存储模块，负责分组化通信。", [ /NoC 片上网络（Network on Chip）/u, /路由|链路|通信/u ]),
    term("rtl", "RTL", "RTL 用寄存器之间的数据传送和组合逻辑描述数字硬件的时钟级行为。", [ /RTL 寄存器传输级（Register-?Transfer Level）/u, /寄存器|时钟/u ]),
    term("hdl", "HDL", "HDL 用形式化文本描述数字电路的结构、行为和验证模型。", [ /HDL 硬件描述语言（Hardware Description Language）/u, /电路|硬件/u ]),
    term("hbm", "HBM", "HBM 把多层存储晶粒垂直堆叠，并通过宽接口提供高带宽数据传输。", [ /HBM 高带宽存储器（High Bandwidth Memory）/u, /堆叠|带宽/u ]),
    term("sram", "SRAM", "SRAM 使用双稳态存储单元保存数据，不需要像动态存储器那样周期刷新。", [ /SRAM 静态随机存取存储器（Static Random-?Access Memory）/u, /刷新|双稳态/u ]),
    term("dram", "DRAM", "DRAM 以电容电荷表示数据，需要周期刷新以补偿电荷泄漏。", [ /DRAM 动态随机存取存储器（Dynamic Random-?Access Memory）/u, /电容|刷新/u ]),
    term("sta", "STA", "STA 不依赖输入激励波形，而是沿时序图传播延迟并检查路径约束。", [ /STA 静态时序分析（Static Timing Analysis）/u, /时序|路径|延迟/u ]),
    term("drc", "DRC", "DRC 检查集成电路版图是否满足最小宽度、间距和包围等制造规则。", [ /DRC 设计规则检查（Design Rule Check）/u, /版图|制造|间距/u ]),
    term("lvs", "LVS", "LVS 比较版图提取的网络表与原理图网络表，检查器件和连接是否一致。", [ /LVS 版图与原理图一致性检查（Layout Versus Schematic）/u, /网络表|网表|连接|互连/u ]),
    term("ppa", "PPA", "物理设计联合权衡 PPA，即功耗、性能与面积三个相互制约的目标。", [ /PPA 功耗、性能与面积（Power, Performance, and Area）/u, /权衡|制约/u ]),
    term("ir-drop", "IR Drop", "供电网络中的电流流过非零电阻会产生 IR Drop，使负载端电压低于电源端。", [ /电阻|电流|电压/u, /欧姆|压降/u ], [ /红外/u ]),
    term("chiplet", "Chiplet", "Chiplet 是把大型芯片功能拆分为多个可独立制造的晶粒，再通过封装互连组合成系统。", [ /小芯片|芯粒|晶粒/u, /封装|互连/u ]),
    term("interposer", "Interposer", "Interposer 位于多个晶粒与封装基板之间，提供高密度横向互连和信号扇出。", [ /中介层/u, /晶粒|互连|封装/u ]),
    term("hybrid-bonding", "Hybrid Bonding", "Hybrid Bonding 同时连接晶粒表面的介质与金属触点，用于实现细间距三维互连。", [ /混合键合/u, /介质|金属|互连/u ]),
    term("setup-time", "Setup Time", "触发器要求输入数据在有效时钟沿到来之前保持稳定一段最短时间。", [ /建立时间/u, /时钟沿|稳定/u ]),
    term("hold-time", "Hold Time", "触发器要求输入数据在有效时钟沿到来之后继续保持稳定一段最短时间。", [ /保持时间/u, /时钟沿|稳定/u ]),
    question("power-difference", "quantitative", "方案 A 和方案 B 的平均功耗谁更高，相差多少？", "相同电压、频率与工作负载下，方案 A 为 138 mW，方案 B 为 104 mW。", [ /方案 A/u, /高|大/u, /34\s*mW/u ]),
    question("latency-reduction", "quantitative", "优化前后延迟降低了多少纳秒，降幅是多少？", "优化前端到端延迟为 80 ns，优化后为 60 ns，测量口径相同。", [ /20\s*(?:ns|纳秒)/u, /25\s*%|百分之二十五/u ]),
    question("throughput-ratio", "quantitative", "新方案吞吐量是旧方案的多少倍，提高了百分之多少？", "旧方案吞吐量为 200 GB/s，新方案为 300 GB/s，二者采用相同数据口径。", [ /1\.5\s*倍/u, /50\s*%|百分之五十/u ]),
    question("area-tradeoff", "quantitative", "面积从 40 mm² 增加到 46 mm²，增加量与增幅分别是多少？", "基线面积为 40 mm²，修改后面积为 46 mm²。", [ /6\s*mm/u, /15\s*%|百分之十五/u ]),
    question("sram-dram", "explanation", "SRAM 与 DRAM 的存储方式和典型权衡有什么区别？", "SRAM 用双稳态单元保存数据，速度快但单元面积较大；DRAM 用电容保存数据，需要刷新，但密度通常更高。", [ /双稳态|触发器/u, /电容/u, /刷新/u, /密度|面积|集成度/u ], [ /\d+\s*(?:ns|ms)|\d+\s*(?:个)?晶体管/iu ]),
    question("setup-violation", "explanation", "建立时间违例为什么通常通过减小数据路径延迟或放宽时钟周期修复？", "建立时间检查要求数据在捕获时钟沿之前到达并稳定；组合路径过慢或时钟周期过短会使到达时间晚于要求时间。", [ /捕获时钟沿|时钟沿/u, /路径延迟|组合路径/u, /周期/u ]),
    question("hold-violation", "explanation", "保持时间违例为什么不能简单通过降低时钟频率修复？", "保持时间检查关注同一捕获时钟沿之后的短时间窗口；过快的数据路径会让新数据过早到达。", [ /时钟沿|保持时间窗口|保持时间裕量/u, /过早|过快|延迟过短|路径过短/u, /频率|周期/u ], [ /降低频率即可/u ]),
    question("pdn-cause", "explanation", "哪些直接因素决定供电网络的电压降？", "负载电流流过供电路径电阻形成电阻性压降；瞬态电流、寄生电感、去耦电容和负载分布还会影响动态电压波动。", [ /电流/u, /电阻/u, /电感|去耦电容/u, /负载/u ]),
    question("backside-boundary", "boundary", "背面供电降低电压降后，为什么仍不能直接断言芯片性能一定提高？", "背面供电缩短了部分供电路径并释放正面布线资源；材料只报告压降变化，没有给出工作频率、时序裕量或端到端性能测量。", [ /压降|供电/u, /频率|时序|性能测量/u, /不能|不足|无法/u ], [ /热阻|寄生效应/u ]),
    question("evidence-boundary", "boundary", "能否根据这段数据判断方案在所有工作负载下都更省电？", "在工作负载 X 下，方案 A 为 70 mW，方案 B 为 82 mW；没有提供其他工作负载的测量。", [ /不能|无法|不足/u, /其他工作负载/u ]),
    question("parallel-boundary", "boundary", "两个阶段分别耗时 3 ms 和 5 ms，能否直接断言总耗时是 8 ms？", "资料只给出阶段 A 为 3 ms、阶段 B 为 5 ms，没有说明二者串行、并行还是存在重叠。", [ /不能|无法/u, /串行|并行|重叠|时序关系|先后关系|执行方式/u, /8\s*ms/u ]),
    question("three-d-stack", "explanation", "三维堆叠为什么能缩短部分互连，但会增加哪些热与制造约束？", "垂直堆叠让部分模块通过短垂直互连通信，缩短横向走线；多层晶粒提高功率密度，散热路径更复杂，键合良率也会影响整体成品率。", [ /垂直互连/u, /缩短|走线|距离/u, /散热|功率密度/u, /良率|键合/u ]),
    question("ppa-tradeoff", "explanation", "为什么 PPA 优化通常不是三个指标同时无条件变好？", "提高频率可能需要更强驱动和更多缓冲，从而增加功耗与面积；减小面积也可能造成拥塞并拉长关键路径。", [ /功耗/u, /面积/u, /频率|性能/u, /权衡|制约|拥塞/u ]),
    question("clock-skew", "explanation", "时钟偏差如何以不同方向影响建立时间和保持时间裕量？", "捕获时钟相对发射时钟更晚到达时，建立时间可用窗口增大，但同一路径的保持时间约束可能更紧；反向偏差的影响方向相反。", [ /建立/u, /保持/u, /捕获/u, /更晚|方向|正向偏差|反向偏差|正偏差|负偏差/u ]),
    question("ambiguous-dac", "boundary", "这段话里的 DAC 指会议还是数模转换器？依据是什么？", "该成果被 DAC 2026 的研究论文环节接收，讨论主题是电子设计自动化和芯片物理设计。", [ /设计自动化会议（Design Automation Conference）/u, /会议/u ]),
    question("journal-name", "explanation", "这篇论文发表于什么期刊？给出规范名称。", "论文发表于 ACM Trans. Design Autom. Electr. Syst.，正式英文名是 ACM Transactions on Design Automation of Electronic Systems。", [ /计算机学会设计自动化电子系统汇刊（ACM Transactions on Design Automation of Electronic Systems）/u ]),
    question("orcid-purpose", "explanation", "ORCID 解决了什么问题，它保存的核心关系是什么？", "ORCID 为研究人员分配持久标识符，用于区分重名作者，并把研究人员身份与论文、数据集等研究成果关联起来。", [ /ORCID 开放研究者与贡献者标识符（Open Researcher and Contributor ID）/u, /重名|歧义|身份识别/u, /研究成果/u ]),

    diverse(term("pcr", "PCR", "PCR 通过引物、模板、核苷酸和耐热 DNA 聚合酶的循环反应扩增特定核酸片段。", [ /PCR 聚合酶链式反应（Polymerase Chain Reaction）/u, /扩增/u, /引物|聚合酶/u ]), "biology", "textbook"),
    diverse(term("mrna", "mRNA", "mRNA 把 DNA 中的遗传信息携带到核糖体，作为蛋白质翻译的模板。", [ /mRNA 信使核糖核酸（Messenger Ribonucleic Acid）/u, /遗传信息|信息传递|模板|密码子|指导核糖体|连接基因与蛋白质|基因表达/u, /蛋白质|翻译|多肽|组装氨基酸/u ]), "biology", "textbook"),
    diverse(question("antibiotic-resistance", "explanation", "抗生素耐药性为什么会在群体中扩散？", "细菌群体原本存在遗传变异；抗生素杀死敏感细菌后，耐药细菌更容易存活和繁殖，耐药基因还可通过水平基因转移传播。", [ /选择|敏感细菌|存活/u, /繁殖|扩散/u, /基因|水平基因转移/u ], [ /人体产生耐药|患者对药物耐药/u ]), "medicine", "textbook"),
    diverse(question("relative-risk", "quantitative", "治疗组和对照组的不良事件风险相差多少个百分点，风险比是多少？", "治疗组 200 人中有 8 人发生不良事件；对照组 200 人中有 16 人发生不良事件。", [ /4(?:\.0)?\s*(?:%|％|个百分点|个百分)/u, /0\.5|一半|50\s*%/u, /治疗组/u ], [ /降低了 4\s*%[^；\n]{0,30}相对/u ]), "medicine", "table"),
    diverse(question("observational-medicine-boundary", "boundary", "这项观察是否能证明咖啡直接降低疾病风险？", "一项观察性研究发现经常喝咖啡的人疾病发生率较低，但两组在年龄、吸烟、运动和收入方面也存在差异，研究没有随机分组。", [ /不能|不足|无法/u, /观察性|随机/u, /混杂|年龄|吸烟|运动/u ], [ /(?:(?<!不能)(?<!无法)(?<!未能)证明咖啡|必然降低)/u ]), "medicine", "news"),

    diverse(term("gdpr", "GDPR", "GDPR 规定欧盟范围内个人数据处理的合法性基础、数据主体权利和控制者责任。", [ /GDPR 通用数据保护条例（General Data Protection Regulation）/u, /个人数据/u, /权利|责任|处理/u ]), "law", "manual"),
    diverse(question("burden-of-proof", "explanation", "为什么民事案件与刑事案件的证明标准通常不同？", "这段法学教材区分民事责任与刑事处罚；民事裁判通常比较哪一方事实主张更可能成立，刑事定罪则要求排除合理怀疑。", [ /民事/u, /刑事/u, /排除合理怀疑/u, /更可能|可能性|优势证据|优势盖然|高度盖然/u ]), "law", "textbook"),
    diverse(question("contract-law-boundary", "boundary", "仅凭这段合同摘录，能否断言迟延一天就一定要支付全部违约金？", "合同写明迟延交付可能触发违约金，但摘录没有给出宽限期、上限、适用法律、不可抗力条款或法院对金额的调整规则。", [ /不能|无法|不足/u, /宽限期|适用法律|不可抗力|调整/u ], [ /一定支付|必须支付全部/u ]), "law", "argument"),

    diverse(term("pe-ratio", "P/E", "P/E 用股票市场价格除以每股收益，常用于比较市场价格相对于盈利的水平。", [ /市盈率/u, /Price-to-Earnings Ratio/u, /价格|股价/u, /收益|盈利/u ]), "finance", "news"),
    diverse(question("cagr", "quantitative", "这项投资两年的复合年增长率是多少？", "投资价值从期初 100 万元增长到两年后的 121 万元，中间没有追加或提取资金。", [ /10\s*%|百分之十/u, /复合|年增长/u ], [ /21\s*%[^；\n]{0,30}每年/u ]), "finance", "table"),
    diverse(question("short-window-volatility", "boundary", "能否用这五个交易日的波动直接断言该资产长期风险更低？", "样本只包含连续五个交易日；资产 A 的日收益波动小于资产 B，但没有更长周期、极端行情或流动性数据。", [ /不能|无法|不足/u, /样本|五个交易日|长期/u, /极端|流动性|周期/u ]), "finance", "news"),

    diverse(term("p-value", "p-value", "在零假设成立并满足模型假设时，p-value 衡量观察到当前或更极端数据的概率。", [ /零假设/u, /更极端|至少[^；\n]{0,16}一样极端|同样[^；\n]{0,16}极端/u, /概率/u ], [ /p值(?:就是|等于|表示)零假设为真的概率|p-value(?:就是|等于|表示)零假设为真的概率|结果由偶然造成的概率/u ]), "statistics", "textbook"),
    diverse(question("simpsons-paradox", "explanation", "为什么总体趋势可能与每个分组中的趋势相反？", "数据按治疗难度分为轻症和重症；两种治疗在每个难度组内都表现更好的一方，在合并数据后却因为两组患者构成差异而显得更差。", [ /辛普森悖论|分组|组内|难度组|分层|各层/u, /构成|比例|占比|混杂|分布(?:差异|不均)|样本量|权重/u, /总体|合并/u ]), "statistics", "paper"),
    diverse(question("bayes-screening", "quantitative", "检测结果为阳性时，受检者真正患病的概率约是多少？", "患病率为 1%；检测灵敏度为 90%，特异度为 95%；假设样本符合这些条件。", [ /15(?:\.(?:3|4)\d*)?\s*%|约百分之十五/u, /假阳性|特异度/u, /患病率|基础概率/u ]), "statistics", "table"),
    diverse(question("correlation-causation", "boundary", "冰淇淋销量与溺水人数同时上升，能否据此判断冰淇淋导致溺水？", "按月份统计时，两者在夏季都上升；资料还显示气温升高会同时增加冰淇淋消费和游泳活动。", [ /不能|无法/u, /气温|夏季/u, /混杂|混淆|共同原因|相关/u ], [ /(?:所以|因此|表明|证明)冰淇淋导致溺水/u ]), "statistics", "news"),

    diverse(term("decibel", "dB", "dB 用对数尺度表示两个功率量或幅度量的比值；换算系数取决于比较的是功率还是幅度。", [ /dB 分贝（Decibel）/u, /对数/u, /功率|幅度/u, /比值/u ]), "physics", "manual"),
    diverse(question("entropy-disorder", "explanation", "为什么不能简单把热力学熵等同于肉眼看到的混乱程度？", "热力学熵与给定宏观约束下可实现的微观状态数有关；日常所说的整齐或混乱不一定对应微观状态数的变化。", [ /微观状态/u, /宏观/u, /不能|不等同|不一定|而不是|没有直接对应|完全不同/u, /混乱|整齐|排列/u ]), "physics", "textbook"),

    diverse(question("weather-climate", "explanation", "天气与气候的时间尺度和讨论对象有什么区别？", "天气描述某地短时间内的大气状态；气候统计一个地区较长时期的平均状况、变率和极端事件分布。", [ /短时间|短期/u, /长期|较长时期/u, /平均|变率|分布/u ]), "climate", "textbook"),
    diverse(question("single-storm-boundary", "boundary", "一次强暴风雪能否单独证明全球变暖不存在？", "暴风雪是一次区域性天气事件；判断长期气候变化需要分析多年全球或区域温度、海洋热含量等多类观测。", [ /不能|无法/u, /天气事件/u, /长期|多年/u, /全球|海洋热含量|多类观测/u ]), "climate", "news"),

    diverse(term("silk-road", "丝绸之路", "丝绸之路不是一条固定道路，而是古代连接东亚、中亚、西亚及更远地区的陆路与海路贸易交流网络。", [ /贸易|交流/u, /网络|路线/u, /陆路|海路/u ], [ /唯一道路|单一路线/u ]), "history", "textbook"),
    diverse(question("primary-secondary-source", "explanation", "历史研究中的一手史料与二手研究有什么区别？", "研究者同时使用当时形成的书信、账簿和法令，以及后世学者基于多种材料写成的研究专著。", [ /一手/u, /当时|同时代|发生时/u, /二手/u, /后世|研究/u ]), "history", "paper"),

    diverse(term("unreliable-narrator", "不可靠叙述者", "小说中的第一人称叙述者不断自相矛盾，并隐瞒会改变读者判断的事实。", [ /叙述/u, /可信|可靠|不可全信/u, /读者/u, /矛盾|冲突|隐瞒|不一致|偏差|差异|欺骗|扭曲/u ]), "humanities", "textbook"),
    diverse(question("author-intent-boundary", "boundary", "仅凭诗中反复出现的雨意象，能否断言作者本人当时患有抑郁症？", "诗歌多次使用雨、阴影和空屋等意象，但材料没有作者日记、书信、医学记录或同时代证词。", [ /不能|无法|不足/u, /意象|文本/u, /日记|书信|记录|证词/u ], [ /作者患有抑郁症/u ]), "humanities", "argument"),

    diverse(term("rest", "REST", "REST 描述网络应用的一组架构约束，包括客户端与服务器分离、无状态交互、统一接口和可缓存性。", [ /REST 表述性状态转移（Representational State Transfer）/u, /架构/u, /无状态/u, /统一接口|缓存/u ]), "software", "manual"),
    diverse(question("race-condition", "explanation", "为什么同一段并发代码有时正确、有时失败？", "两个线程在没有同步的情况下读写同一共享计数器，最终结果取决于读、改、写操作的实际交错顺序。", [ /线程/u, /共享/u, /顺序|交错/u, /同步|非确定/u ]), "software", "noisy-note"),
    diverse(question("semantic-version", "quantitative", "按照语义化版本约定，1.4.2、1.5.0 和 2.0.0 分别通常表示什么变化？", "说明书采用 MAJOR.MINOR.PATCH；修复兼容性错误递增 PATCH，新增向后兼容功能递增 MINOR，不兼容接口变化递增 MAJOR。", [ /1\.4\.2/u, /修复|修正|PATCH/u, /1\.5\.0/u, /兼容(?:的)?(?:新)?功能|功能性新增|MINOR/u, /2\.0\.0/u, /不兼容|MAJOR/u ]), "software", "specification"),
    diverse(question("attention-ambiguity", "explanation", "这里的 attention 指人的注意力还是机器学习机制？", "The encoder computes attention weights over input tokens, then forms a weighted sum of value vectors；这里讨论的是 Transformer 模型。", [ /机器学习|模型/u, /权重/u, /输入|词元|token/iu, /加权/u ], [ /attention 指人的注意力|attention 是心理状态/u ]), "software", "bilingual"),

    diverse(term("tls", "TLS", "TLS 为客户端与服务器之间的网络通信提供机密性、完整性与身份认证机制。", [ /TLS 传输层安全协议（Transport Layer Security）/u, /加密|机密/u, /完整性/u, /认证|身份验证|真实性/u ]), "networking", "manual"),
    diverse(question("http-429-503", "explanation", "HTTP 429 与 503 在重试策略上有什么不同？", "接口返回 429 表示请求过多，并附带 Retry-After；另一服务在维护期间返回 503，也可能附带 Retry-After。客户端需要限速、退避，并避免无界立即重试。", [ /429/u, /请求过多|过多请求|速率限制|限速/u, /503/u, /不可用|无法处理|维护|临时状态|等待服务器恢复/u, /Retry-After|退避/u ]), "networking", "specification"),

    diverse(term("opportunity-cost", "机会成本", "选择方案 A 意味着放弃可获得的最佳替代方案 B；经济分析把被放弃的最佳替代收益计入决策成本。", [ /最佳替代|价值最高|次优替代/u, /放弃/u, /收益|价值/u ]), "economics", "textbook"),
    diverse(question("cpi-change", "quantitative", "消费者价格指数从 120 上升到 126，对应的涨幅是多少？", "两个指数采用相同基期与统计口径；前期 CPI 为 120，本期 CPI 为 126。", [ /5(?:\.0+)?\s*%|百分之五/u, /6/u ], [ /6(?:\.0+)?\s*%|百分之六/u ]), "economics", "table"),

    diverse(question("cloudflare-warp-product", "explanation", "Cloudflare WARP 在这里是什么，WARP 是否应被强行展开成英文缩写？", "Cloudflare WARP 是 Cloudflare 提供的网络连接产品名；官方将 WARP 作为产品名称使用，这段材料没有给出逐字母英文展开。", [ /Cloudflare WARP/u, /产品/u, /网络|连接/u, /没有|不应|不是/u ], [ /WARP [\\p{Script=Han}]+（[A-Za-z][^)）]+）/u ]), "networking", "manual"),
    diverse(term("orion-x", "Orion-X", "Orion-X 是团队内部为多模态检索原型使用的项目代号；文档明确说明它不是英文短语的首字母缩写。", [ /Orion-X/u, /项目|原型/u, /多模态|检索/u ], [ /（Orion-X）/u, /Orion-X [\\p{Script=Han}]+（[A-Za-z][^)）]+）/u ]), "software", "noisy-note"),

    diverse(term("morpheme", "morpheme", "A morpheme is the smallest linguistic unit that carries meaning or a grammatical function；例如 cats 包含 cat 和复数标记 -s。", [ /语素/u, /最小/u, /意义|语法功能/u ]), "language", "bilingual"),
    diverse(question("bank-ambiguity", "explanation", "句子中的 bank 指银行还是河岸？", "After the flood, sediment accumulated along the river bank and changed the channel shape；上下文讨论洪水、沉积物和河道。", [ /河岸|河堤/u, /洪水|沉积物|河道/u ], [ /bank (?:指|是)银行|应理解为银行/u ]), "language", "bilingual"),
    diverse(question("ram-dialogue", "explanation", "这段对话里的 RAM 指什么，为什么增加它可能减少卡顿？", "用户：打开大型数据集后程序频繁把数据换到磁盘；客服：设备只有 8 GB RAM，升级内存可减少交换，但不会让处理器本身变快。", [ /RAM 随机存取存储器（Random Access Memory）/u, /内存|随机存取存储器/u, /磁盘|交换/u ], [ /处理器速度一定提高/u ]), "software", "dialogue"),
    diverse(question("revenue-profit-news", "quantitative", "新闻称营收从 8000 万元增至 1 亿元，能否据此计算利润增长率？", "报道只给出两年的营业收入，没有披露成本、费用、税项或两年的净利润。", [ /不能|无法/u, /营收|收入/u, /成本|费用|净利润/u ], [ /利润增长率为 25/u ]), "finance", "news"),
    diverse(question("rfc-keywords", "explanation", "规范中的 MUST、SHOULD 和 MAY 表示怎样不同的约束强度？", "The key words MUST, SHOULD, and MAY are to be interpreted as requirement levels；MUST is an absolute requirement, SHOULD allows justified exceptions, and MAY is optional。", [ /MUST/u, /必须|绝对要求/u, /SHOULD/u, /例外|理由/u, /MAY/u, /可选/u ]), "networking", "specification"),

    diverse(term("dblp-proper-name", "DBLP", "DBLP 是计算机科学领域的开放书目数据库和信息服务；官方当前使用 dblp computer science bibliography 作为品牌名称。", [ /计算机科学书目数据库（dblp computer science bibliography）/u, /书目|作者|论文/u ], [ /DataBase systems and Logic Programming|Digital Bibliography & Library Project/u ]), "software", "manual"),
    diverse(term("circuit-partition", "电路划分", "论文作者为 Sung Kyu Lim；正文讨论基于边可分性的电路聚类及其在电路划分中的应用。电路划分把规模较大的电路拆成若干较小部分，并尽量减少部分之间的连接。", [ /拆|分成|划分/u, /电路/u, /连接|跨分区|切割/u ], [ /现任|教授|佐治亚理工/u ]), "electronic-design", "paper"),
    diverse(term("edge-separability", "边可分性", "在电路聚类语境中，边可分性衡量一条连接是否适合作为分开不同节点组的边界；论文作者信息不属于该术语的定义。", [ /连接|边/u, /分开|分组|边界|分界|切割|分割/u ], [ /作者|教授|现任/u ]), "electronic-design", "paper"),
    diverse(question("plain-circuit-partition", "explanation", "为什么电路划分有用？请先用非专业读者能懂的话解释，再说明技术机制。", "一个大型电路包含很多互相连接的元件；如果直接整体处理，设计工具可能更慢、更难优化。电路划分把它拆成较小部分，同时控制跨部分连接数量。", [ /大|复杂|整体/u, /拆|分成|划分/u, /连接|连线/u ], [ /曾任|作者|论文发表/u ]), "electronic-design", "textbook"),

    diverse(term("tess", "TESS", "TESS 是一颗通过持续测量恒星亮度来寻找凌日系外行星候选体的空间望远镜。", [ /TESS 凌日系外行星巡天卫星（Transiting Exoplanet Survey Satellite）/u, /恒星|亮度/u, /系外行星|凌日/u ]), "astronomy", "textbook"),
    diverse(question("transit-detection", "explanation", "凌日法为什么要寻找恒星亮度的周期性下降？", "行星从恒星前方经过时会遮挡一小部分星光；同样形状的亮度下降按稳定周期重复，才更像轨道运动而不是随机噪声。", [ /遮挡|星光/u, /周期|重复/u, /噪声|随机/u ]), "astronomy", "textbook"),
    diverse(question("single-transit-boundary", "boundary", "只看到一次亮度下降，能否直接确认发现了系外行星？", "观测只记录到一次亮度下降；恒星活动、仪器噪声和双星掩食也可能产生相似信号，没有重复周期或后续观测。", [ /不能|无法|不足/u, /恒星活动|仪器噪声|双星/u, /重复|后续观测|周期/u ]), "astronomy", "argument"),

    diverse(term("mri", "MRI", "MRI 使用强磁场与射频信号测量人体组织中氢核的响应，并重建软组织图像。", [ /MRI 磁共振成像（Magnetic Resonance Imaging）/u, /磁场/u, /软组织|图像/u ]), "medicine", "manual"),
    diverse(term("ecg", "ECG", "ECG 记录心脏电活动随时间的变化，用于观察心律与传导异常。", [ /ECG 心电图（Electrocardiogram）/u, /心脏|心律/u, /电活动/u ]), "medicine", "manual"),
    diverse(question("mri-ct", "explanation", "MRI 与 CT 的成像信号来源和典型优势有什么不同？", "MRI 依靠磁场和射频信号形成图像，软组织对比度通常较好；CT 使用 X 射线从多个角度采集衰减数据，成像速度快且适合观察骨骼和急性出血。", [ /MRI 磁共振成像（Magnetic Resonance Imaging）/u, /CT 计算机断层扫描（Computed Tomography）/u, /磁场|射频/u, /X 射线/u ], [ /MRI[^；\n]{0,20}电离辐射产生/u ]), "medicine", "textbook"),

    diverse(term("mfa", "MFA", "MFA 要求用户提供来自两个或更多不同类别的身份凭据，例如知道的秘密与持有的设备。", [ /MFA 多因素身份验证（Multi-Factor Authentication）/u, /两个|更多/u, /凭据|因素/u ]), "cybersecurity", "manual"),
    diverse(term("xss", "XSS", "XSS 是攻击者把恶意脚本注入可信网页，使脚本在其他用户的浏览器中执行的安全漏洞。", [ /XSS 跨站脚本（Cross-Site Scripting）/u, /脚本/u, /浏览器/u, /注入|执行/u ]), "cybersecurity", "manual"),
    diverse(term("csrf", "CSRF", "CSRF 诱使已经登录的浏览器向目标网站发送用户并未主动批准的请求。", [ /CSRF 跨站请求伪造（Cross-Site Request Forgery）/u, /登录|会话/u, /请求/u, /诱使|伪造/u ]), "cybersecurity", "manual"),
    diverse(question("xss-csrf", "explanation", "XSS 与 CSRF 分别利用了什么信任关系，防护重点有什么不同？", "XSS 让目标站点向浏览器交付并执行攻击者脚本；CSRF 借用浏览器已有的登录状态发送伪造请求。前者重点防止不可信内容进入可执行上下文，后者重点验证请求来源与用户意图。", [ /XSS 跨站脚本（Cross-Site Scripting）/u, /CSRF 跨站请求伪造（Cross-Site Request Forgery）/u, /脚本/u, /登录|会话|浏览器所发起请求的信任|认证|凭据/u, /来源|意图/u ]), "cybersecurity", "specification"),

    diverse(term("acid", "ACID", "ACID 概括数据库事务的原子性、一致性、隔离性与持久性，用于约束事务在成功、并发和故障情况下的行为。", [ /ACID 原子性、一致性、隔离性与持久性（Atomicity, Consistency, Isolation, and Durability）/u, /事务/u, /并发|故障/u ]), "databases", "textbook"),
    diverse(term("oltp", "OLTP", "OLTP 面向大量短小且并发的日常业务事务，例如下单、支付和库存更新。", [ /OLTP 联机事务处理（Online Transaction Processing）/u, /事务/u, /并发|日常业务/u ]), "databases", "manual"),
    diverse(term("etl", "ETL", "ETL 把数据从多个来源抽取出来，按目标规则清洗和转换，再装载到分析系统。", [ /ETL 抽取、转换与加载（Extract, Transform, and Load）/u, /抽取/u, /转换|清洗/u, /加载|装载/u ]), "databases", "manual"),
    diverse(question("acid-crash-boundary", "boundary", "数据库声称支持 ACID，能否据此断言任何硬件故障都不会丢数据？", "系统说明事务遵守 ACID，但没有给出存储介质、刷盘策略、复制方式、备份恢复目标或灾难范围。", [ /ACID 原子性、一致性、隔离性与持久性（Atomicity, Consistency, Isolation, and Durability）/u, /不能|无法|不足/u, /刷盘|复制|备份|灾难/u ]), "databases", "argument"),

    diverse(term("rag", "RAG", "RAG 在生成回答前先从外部资料中检索相关内容，再把检索结果作为模型生成时的依据。", [ /RAG 检索增强生成（Retrieval-Augmented Generation）/u, /检索/u, /生成/u, /外部资料|外部知识|知识库|依据|上下文/u ]), "artificial-intelligence", "textbook"),
    diverse(term("llm", "LLM", "LLM 是在大规模文本上训练、用于理解和生成自然语言内容的模型。", [ /LLM 大语言模型（Large Language Model）/u, /文本/u, /语言/u, /生成|理解/u ]), "artificial-intelligence", "textbook"),
    diverse(term("cnn", "CNN", "CNN 使用可学习的卷积核在局部区域共享参数，逐层提取图像或网格数据中的特征。", [ /CNN 卷积神经网络（Convolutional Neural Network）/u, /卷积/u, /局部|共享/u, /特征/u ]), "artificial-intelligence", "paper"),
    diverse(question("rag-hallucination", "explanation", "RAG 为什么能减少部分幻觉，却不能保证回答一定正确？", "检索能给生成模型提供与问题相关的外部证据，减少完全依赖参数记忆的情况；但检索可能漏掉资料、找到错误来源，模型也可能误读或忽略证据。", [ /RAG 检索增强生成（Retrieval-Augmented Generation）/u, /检索/u, /证据|来源/u, /不能|不保证|无法保证|仍可能/u, /误读|忽略|错误/u ]), "artificial-intelligence", "argument"),
    diverse(question("llm-rag-api", "explanation", "LLM、RAG 和 API 在一个问答服务中分别承担什么角色？", "服务通过 API 接收问题；RAG 先检索相关文档并整理证据；LLM 再依据问题与证据生成自然语言回答。", [ /LLM 大语言模型（Large Language Model）/u, /RAG 检索增强生成（Retrieval-Augmented Generation）/u, /API 应用程序编程接口（Application Programming Interface）/u, /检索|证据/u, /生成/u ]), "artificial-intelligence", "technical-note"),

    diverse(term("nmr", "NMR", "NMR 利用原子核在磁场中的共振响应来推断分子结构和局部化学环境。", [ /NMR 核磁共振（Nuclear Magnetic Resonance）/u, /磁场/u, /分子结构|化学结构|化学环境|电子环境/u ]), "chemistry", "textbook"),
    diverse(question("ph-log-scale", "explanation", "为什么 pH 相差 1 通常对应氢离子活度约相差 10 倍？", "pH 使用以 10 为底的负对数表示氢离子活度；数值改变 1 意味着对数对应的原始量改变一个十倍因子。", [ /负对数|对数/u, /10\s*倍|十倍/u, /氢离子/u ]), "chemistry", "textbook"),

    diverse(term("pid", "PID", "PID 根据当前误差、误差累积和误差变化速度组合出控制量。", [ /PID 比例—积分—微分（Proportional-Integral-Derivative）/u, /误差/u, /累积|积分/u, /变化|微分/u ]), "control", "manual"),
    diverse(term("mpc", "MPC", "MPC 使用系统模型预测未来一段时间的行为，并反复求解带约束的控制优化问题。", [ /MPC 模型预测控制（Model Predictive Control）/u, /预测/u, /约束/u, /优化/u ]), "control", "textbook"),
    diverse(question("pid-windup", "explanation", "执行器饱和时，PID 的积分项为什么可能继续累积并造成恢复迟缓？", "执行器达到输出上限后，实际输出不能继续增加；误差仍存在时积分项继续累积，解除饱和后需要先消除过量积分，系统才会恢复正常调节。", [ /PID 比例—积分—微分（Proportional-Integral-Derivative）/u, /饱和|上限/u, /积分/u, /恢复|消除/u ]), "control", "technical-note"),

    diverse(term("fft", "FFT", "FFT 是更高效地计算离散傅里叶变换的一类算法，利用变换结构减少重复计算。", [ /FFT 快速傅里叶变换（Fast Fourier Transform）/u, /离散傅里叶/u, /重复计算|高效/u ]), "mathematics", "textbook"),
    diverse(term("svd", "SVD", "SVD 把矩阵分解为两个正交方向变换与一组非负奇异值，用于揭示主要方向和有效秩。", [ /SVD 奇异值分解（Singular Value Decomposition）/u, /矩阵/u, /奇异值/u, /秩|方向|旋转/u ]), "mathematics", "textbook"),

    diverse(term("cad", "CAD", "CAD 使用计算机软件辅助创建、修改和检查工程设计的几何模型与图纸。", [ /CAD 计算机辅助设计（Computer-Aided Design）/u, /几何|图纸/u, /设计/u ]), "mechanical-engineering", "manual"),
    diverse(term("cfd", "CFD", "CFD 用数值方法求解描述流体运动与传热的方程，从而预测速度、压力和温度分布。", [ /CFD 计算流体力学（Computational Fluid Dynamics）/u, /流体/u, /数值/u, /速度|压力|温度/u ]), "mechanical-engineering", "textbook"),
    diverse(question("cad-cfd-fea", "explanation", "CAD、CFD 与 FEA 在机械设计流程中分别做什么？", "CAD 建立零件和装配体的几何模型；CFD 基于几何与边界条件分析流动和传热；FEA 把结构离散为有限单元，计算应力、变形或振动。", [ /CAD 计算机辅助设计（Computer-Aided Design）/u, /CFD 计算流体力学（Computational Fluid Dynamics）/u, /FEA 有限元分析（Finite Element Analysis）/u, /几何/u, /流动|传热/u, /应力|变形/u ]), "mechanical-engineering", "technical-note"),

    diverse(term("gis", "GIS", "GIS 负责存储、管理、分析和显示带有地理位置的数据。", [ /GIS 地理信息系统（Geographic Information System）/u, /地理|位置/u, /分析|显示/u ]), "geospatial", "manual"),
    diverse(term("gps", "GPS", "GPS 利用多颗导航卫星的信号传播时间估计接收机的位置与时间。", [ /GPS 全球定位系统（Global Positioning System）/u, /卫星/u, /位置|时间/u ]), "geospatial", "textbook"),
    diverse(question("gis-gps", "explanation", "GIS 与 GPS 的角色有什么区别，它们如何配合？", "GPS 负责测得设备的位置与时间；GIS 负责保存、分析并显示位置相关的数据。采集到的定位结果可以作为地理信息系统中的一层数据。", [ /GPS 全球定位系统（Global Positioning System）/u, /GIS 地理信息系统（Geographic Information System）/u, /测得|定位/u, /分析|显示/u ]), "geospatial", "manual"),

    diverse(term("cbt", "CBT", "CBT 是一种通过识别并调整不利思维模式和行为习惯来改善情绪与应对方式的心理治疗。", [ /CBT 认知行为疗法（Cognitive Behavioral Therapy）/u, /思维/u, /行为/u, /情绪|应对/u ]), "psychology", "textbook"),
    diverse(term("midi", "MIDI", "MIDI 规定电子乐器与软件之间交换音符、力度、控制变化和时序等演奏信息的方式。", [ /MIDI 乐器数字接口（Musical Instrument Digital Interface）/u, /电子乐器|软件/u, /音符|力度|时序/u ]), "music", "manual"),
    diverse(term("r0", "R0", "R0 表示在全部人群都易感且没有额外干预时，一个感染者平均造成的新感染人数。", [ /R0 基本再生数（Basic Reproduction Number）/u, /一个(?:典型)?感染者/u, /新感染|继发感染|新病例/u, /易感|干预/u ]), "public-health", "textbook"),
    diverse(question("r0-policy-boundary", "boundary", "只知道 R0 大于 1，能否直接预测某座城市最终会有多少人感染？", "资料只说明基本再生数大于 1，没有给出初始感染人数、接触网络、免疫比例、行为变化、干预措施或随时间变化的传播率。", [ /R0 基本再生数（Basic Reproduction Number）/u, /不能|无法|不足/u, /初始|免疫|接触|干预/u ]), "public-health", "argument"),

    diverse(question("dense-network-acronyms", "explanation", "HTTPS、TLS、HTTP 和 URL 在访问网页时分别表示什么？", "URL 指定要访问的资源位置；HTTP 规定请求和响应的交换方式；HTTPS 表示在 HTTP 通信外使用 TLS 提供加密、完整性与身份认证。", [ /HTTPS 超文本传输安全协议（Hypertext Transfer Protocol Secure）/u, /TLS 传输层安全协议（Transport Layer Security）/u, /HTTP 超文本传输协议（Hypertext Transfer Protocol）/u, /URL 统一资源定位符（Uniform Resource Locator）/u, /加密|完整性|认证/u ]), "networking", "manual"),
    diverse(question("dense-biology-acronyms", "explanation", "DNA、mRNA 和 PCR 在基因检测流程中分别是什么？", "DNA 保存遗传信息；mRNA 是部分基因表达时产生并用于蛋白质翻译的信息载体；PCR 可以在体外扩增目标 DNA 片段以便检测。", [ /DNA 脱氧核糖核酸（Deoxyribonucleic Acid）/u, /mRNA 信使核糖核酸（Messenger Ribonucleic Acid）/u, /PCR 聚合酶链式反应（Polymerase Chain Reaction）/u, /遗传信息/u, /扩增/u ]), "biology", "textbook")
];

const SEARCH_CASES = [
    {
        name: "current-deepseek-models",
        title: "截至 2026 年 7 月，DeepSeek API 当前提供哪些正式模型名称？",
        selected: "需要核验当前 API 模型名称与旧别名的弃用状态。",
        expected: /deepseek-v4-(?:flash|pro)/iu
    },
    {
        name: "current-ieee-president",
        title: "截至 2026 年，IEEE 现任主席是谁？",
        selected: "IEEE 指电气电子工程师学会，需要核验具有时效性的现任负责人。",
        expected: /IEEE|电气电子工程师学会/iu
    },
    {
        name: "current-orcid-role",
        title: "ORCID 当前官方如何描述其标识符用途？",
        selected: "核验 ORCID 的官方定义和当前用途，不需要人物履历。",
        expected: /ORCID|标识符|identifier/iu
    },
    {
        name: "current-riscv-spec",
        title: "RISC-V 当前正式规范由哪个组织维护？",
        selected: "需要核验当前维护机构和规范身份。",
        expected: /RISC-V/iu
    },
    {
        name: "current-usb-version",
        title: "截至 2026 年，USB-IF 当前公布的 USB 规范命名是什么？",
        selected: "需要核验具有版本时效性的官方命名。",
        expected: /USB/iu
    },
    {
        name: "current-node-lts",
        title: "截至 2026 年 7 月，Node.js 当前 LTS 版本线是什么？",
        selected: "需要核验当前长期支持版本线。",
        expected: /Node\.js|LTS/iu
    }
] as const;

function percentile(values: number[], ratio: number): number {
    if (!values.length) return 0;
    const sorted = values.toSorted((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function average(values: number[]): number {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, worker: (value: T, index: number) => Promise<R>): Promise<R[]> {
    const result = new Array<R>(values.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
        while (next < values.length) {
            const index = next++;
            result[index] = await worker(values[index], index);
        }
    }));
    return result;
}

function observeResult(
    testCase: BenchmarkCase,
    repetition: number,
    result: ReadWeaveGenerateResponse,
    latencyMs: number
): GenerationObservation {
    const formatPass = !result.body.includes("。")
        && !/[（(][^（）()\n]{0,300}[（(]/u.test(result.body)
        && !/\.。|。。|；；|\n{3,}/u.test(result.body);
    const missingExpected = testCase.expected.filter(pattern => !pattern.test(result.body)).map(pattern => pattern.source);
    const matchedForbidden = (testCase.forbidden ?? []).filter(pattern => pattern.test(result.body)).map(pattern => pattern.source);
    const qualityIssues = findReadWeaveQualityIssues(result.body, testCase.request.title, {
            kind: testCase.request.kind,
            subject: testCase.request.kind === "term" ? testCase.request.title : undefined,
            termIdentity: result.termIdentity,
            verifiedNonExpandableArtifact: result.verifiedNonExpandableArtifact
        });
    const semanticPass = missingExpected.length === 0 && matchedForbidden.length === 0 && qualityIssues.length === 0;
    return {
        name: testCase.name,
        group: testCase.group,
        domain: testCase.domain ?? "electronic-design",
        style: testCase.style ?? "technical-note",
        repetition,
        accepted: !result.reviewIssues?.length,
        semanticPass,
        formatPass,
        latencyMs,
        costCny: result.usage?.costCny ?? Number.NaN,
        totalTokens: result.usage?.totalTokens ?? 0,
        modelCalls: result.usage?.modelCalls ?? 0,
        contextCharacters: result.context.characterCount,
        body: result.body,
        termIdentity: result.termIdentity,
        qualityIssues,
        missingExpected,
        matchedForbidden
    };
}

describeBenchmark("ReadWeave quality/search/generation/cost balance benchmark", () => {
    it("measures a diverse repeated generation matrix and focused adaptive-search probes", async () => {
        const repetitions = Math.max(1, Number.parseInt(process.env.READWEAVE_BENCHMARK_REPETITIONS ?? "3", 10));
        const caseFilter = process.env.READWEAVE_BENCHMARK_FILTER
            ? new RegExp(process.env.READWEAVE_BENCHMARK_FILTER, "u")
            : undefined;
        const selectedCases = caseFilter ? CASES.filter(testCase => caseFilter.test(testCase.name)) : CASES;
        const jobs = selectedCases.flatMap(testCase =>
            Array.from({ length: repetitions }, (_, repetition) => ({ testCase, repetition: repetition + 1 })));
        const generation = await mapWithConcurrency(jobs, 8, async ({ testCase, repetition }) => {
            const startedAt = performance.now();
            try {
                const result = await generateReadWeaveAnswer(testCase.request);
                return observeResult(testCase, repetition, result, performance.now() - startedAt);
            } catch (error) {
                return {
                    name: testCase.name,
                    group: testCase.group,
                    domain: testCase.domain ?? "electronic-design",
                    style: testCase.style ?? "technical-note",
                    repetition,
                    accepted: false,
                    semanticPass: false,
                    formatPass: false,
                    latencyMs: performance.now() - startedAt,
                    costCny: Number.NaN,
                    totalTokens: 0,
                    modelCalls: 0,
                    contextCharacters: 0,
                    error: error instanceof Error ? error.message : String(error)
                } satisfies GenerationObservation;
            }
        });

        const selectedSearchCases = process.env.READWEAVE_BENCHMARK_SEARCH === "0" ? [] : [ ...SEARCH_CASES ];
        const search = await mapWithConcurrency(selectedSearchCases, 3, async testCase => {
            const startedAt = performance.now();
            try {
                const result = await searchReadWeaveEvidence({
                    query: testCase.title,
                    context: testCase.selected,
                    kind: "question",
                    force: true
                }, { bypassCache: true });
                return {
                    name: testCase.name,
                    accepted: testCase.expected.test(result.memo),
                    memo: result.memo,
                    sourceCount: result.sources.length,
                    providers: result.providers,
                    warnings: result.warnings,
                    latencyMs: performance.now() - startedAt,
                    costCny: result.searchCostCny,
                    totalTokens: 0,
                    modelCalls: 0,
                    error: undefined
                };
            } catch (error) {
                return {
                    name: testCase.name,
                    accepted: false,
                    memo: "",
                    sourceCount: 0,
                    providers: [],
                    warnings: [],
                    latencyMs: performance.now() - startedAt,
                    costCny: Number.NaN,
                    totalTokens: 0,
                    modelCalls: 0,
                    error: error instanceof Error ? error.message : String(error)
                };
            }
        });

        const validGenerationCosts = generation.map(item => item.costCny).filter(Number.isFinite);
        const generationLatencies = generation.map(item => item.latencyMs);
        const validSearchCosts = search.map(item => item.costCny).filter(Number.isFinite);
        const summary = {
            generatedAt: new Date().toISOString(),
            configuration: {
                uniqueGenerationCases: selectedCases.length,
                repetitions,
                generationRequests: generation.length,
                searchRequests: search.length
            },
            generation: {
                accepted: generation.filter(item => item.accepted).length,
                semanticPass: generation.filter(item => item.semanticPass).length,
                formatPass: generation.filter(item => item.formatPass).length,
                acceptanceRate: generation.filter(item => item.accepted && item.semanticPass && item.formatPass).length / generation.length,
                totalCostCny: validGenerationCosts.reduce((sum, value) => sum + value, 0),
                averageCostCny: average(validGenerationCosts),
                p50CostCny: percentile(validGenerationCosts, 0.5),
                p95CostCny: percentile(validGenerationCosts, 0.95),
                maxCostCny: Math.max(...validGenerationCosts, 0),
                averageLatencyMs: average(generationLatencies),
                p50LatencyMs: percentile(generationLatencies, 0.5),
                p95LatencyMs: percentile(generationLatencies, 0.95),
                averageTokens: average(generation.map(item => item.totalTokens)),
                byGroup: Object.fromEntries([ "definition", "explanation", "quantitative", "boundary" ].map(group => {
                    const observations = generation.filter(item => item.group === group);
                    return [ group, {
                        requests: observations.length,
                        passRate: observations.filter(item => item.accepted && item.semanticPass && item.formatPass).length / observations.length,
                        averageCostCny: average(observations.map(item => item.costCny).filter(Number.isFinite)),
                        p95LatencyMs: percentile(observations.map(item => item.latencyMs), 0.95)
                    } ];
                })),
                byDomain: Object.fromEntries([ ...new Set(generation.map(item => item.domain)) ].map(domain => {
                    const observations = generation.filter(item => item.domain === domain);
                    return [ domain, {
                        requests: observations.length,
                        passRate: observations.filter(item => item.accepted && item.semanticPass && item.formatPass).length / observations.length,
                        averageCostCny: average(observations.map(item => item.costCny).filter(Number.isFinite)),
                        p95LatencyMs: percentile(observations.map(item => item.latencyMs), 0.95)
                    } ];
                })),
                byStyle: Object.fromEntries([ ...new Set(generation.map(item => item.style)) ].map(style => {
                    const observations = generation.filter(item => item.style === style);
                    return [ style, {
                        requests: observations.length,
                        passRate: observations.filter(item => item.accepted && item.semanticPass && item.formatPass).length / observations.length,
                        averageCostCny: average(observations.map(item => item.costCny).filter(Number.isFinite)),
                        p95LatencyMs: percentile(observations.map(item => item.latencyMs), 0.95)
                    } ];
                }))
            },
            search: {
                accepted: search.filter(item => item.accepted).length,
                passRate: search.length ? search.filter(item => item.accepted).length / search.length : 1,
                averageSources: average(search.map(item => item.sourceCount)),
                totalCostCny: validSearchCosts.reduce((sum, value) => sum + value, 0),
                averageCostCny: average(validSearchCosts),
                p95CostCny: percentile(validSearchCosts, 0.95),
                averageLatencyMs: average(search.map(item => item.latencyMs)),
                p95LatencyMs: percentile(search.map(item => item.latencyMs), 0.95)
            },
            failures: {
                generation: generation.filter(item => !item.accepted || !item.semanticPass || !item.formatPass),
                search: search.filter(item => !item.accepted)
            },
            observations: { generation, search }
        };

        const outputDirectory = path.resolve(process.cwd(), "../../test-results/readweave-benchmark");
        await mkdir(outputDirectory, { recursive: true });
        const outputPath = path.join(outputDirectory, "latest.json");
        await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
        console.info(`[ReadWeave benchmark] ${JSON.stringify({
            outputPath,
            generation: summary.generation,
            search: summary.search,
            generationFailures: summary.failures.generation.map(item => item.name),
            searchFailures: summary.failures.search.map(item => item.name)
        })}`);

        expect(summary.generation.acceptanceRate).toBe(1);
        expect(summary.generation.maxCostCny).toBeLessThan(0.01);
        if (search.length) {
            expect(summary.search.passRate).toBe(1);
            expect(summary.search.p95CostCny).toBeLessThan(BUDGET_SEARCH_EXPECTED_MAX_COST_CNY);
        }
    }, 900_000);
});

const BUDGET_SEARCH_EXPECTED_MAX_COST_CNY = 0.0065;
