import type { ReadWeaveHarnessCase } from "@triliumnext/commons";

interface QualitySeed {
    category: string;
    question: string;
    expectedFacts: string[];
    forbiddenClaims?: string[];
    context?: string;
}

const VISIBLE_SEEDS: QualitySeed[] = [
    { category: "人物", question: "Fei-Fei Li 是谁", expectedFacts: [ "Fei-Fei Li", "计算机视觉" ], forbiddenClaims: [ "当前文章的作者" ] },
    { category: "人物", question: "Tim Berners-Lee 是谁", expectedFacts: [ "Tim Berners-Lee", "万维网" ], forbiddenClaims: [ "发明了互联网" ] },
    { category: "人物", question: "Sung Kyu Lim 是谁", expectedFacts: [ "Sung Kyu Lim", "电子设计自动化" ], forbiddenClaims: [ "ReadWeave 测试语料" ] },
    { category: "缩写", question: "CPU 是什么", expectedFacts: [ "CPU", "Central Processing Unit", "指令" ], forbiddenClaims: [ "图形处理" ] },
    { category: "缩写", question: "GPU 是什么", expectedFacts: [ "GPU", "Graphics Processing Unit", "并行" ], forbiddenClaims: [ "只用于游戏" ] },
    { category: "缩写", question: "DBLP 是什么", expectedFacts: [ "DBLP", "Digital Bibliography & Library Project", "书目" ], forbiddenClaims: [ "dblp Computer Science Bibliography" ] },
    { category: "缩写", question: "ORCID 是什么", expectedFacts: [ "ORCID", "Open Researcher and Contributor ID", "研究者" ], forbiddenClaims: [ "论文数据库" ] },
    { category: "协议", question: "CXL.io 具体是什么形态", expectedFacts: [ "CXL.io", "协议", "配置" ], forbiddenClaims: [ "独立设备", "三者不是三个互相替代的产品" ] },
    { category: "系统", question: "DAX 是什么", expectedFacts: [ "DAX", "Direct Access", "页面缓存" ], forbiddenClaims: [ "高性能内存硬件" ] },
    { category: "协议", question: "REST 是什么", expectedFacts: [ "REST", "Representational State Transfer", "无状态", "统一接口" ], forbiddenClaims: [ "通信协议" ] },
    { category: "安全", question: "HTTPS 如何保护通信", expectedFacts: [ "HTTPS", "证书", "加密", "完整性" ], forbiddenClaims: [ "RSA 协商所有会话密钥" ] },
    { category: "数学", question: "导数在几何上表示什么", expectedFacts: [ "切线", "变化率" ], forbiddenClaims: [ "函数值本身" ] },
    { category: "数学", question: "贝叶斯定理如何更新概率", expectedFacts: [ "先验", "似然", "后验" ], forbiddenClaims: [ "证明事件必然发生" ] },
    { category: "算法", question: "Kernighan–Lin 算法为什么锁定顶点要持续多轮", expectedFacts: [ "锁定", "最佳前缀", "增益" ], forbiddenClaims: [ "每次交换都必须产生正增益", "割代价单调下降" ] },
    { category: "算法", question: "Kernighan–Lin 算法中的顶点交换增益如何计算", expectedFacts: [ "D_a = E_a - I_a", "D_a + D_b - 2w(a,b)", "割边" ], forbiddenClaims: [ "交换后割边权重减去交换前割边权重" ] },
    { category: "图论", question: "完全图为什么有 n(n-1)/2 条边", expectedFacts: [ "顶点对", "n(n-1)/2" ], forbiddenClaims: [ "每个顶点只有一条边" ] },
    { category: "线性代数", question: "特征值和特征向量表达了什么", expectedFacts: [ "方向", "缩放" ], forbiddenClaims: [ "任意向量方向都不变" ] },
    { category: "医学", question: "MRI 是如何形成图像的", expectedFacts: [ "磁场", "射频", "信号" ], forbiddenClaims: [ "电离辐射成像" ] },
    { category: "医学", question: "PCR 为什么能扩增特定 DNA 片段", expectedFacts: [ "引物", "DNA", "循环" ], forbiddenClaims: [ "直接复制整个基因组" ] },
    { category: "医学", question: "抗生素耐药性是怎样形成的", expectedFacts: [ "选择压力", "耐药" ], forbiddenClaims: [ "人体对药物产生耐药" ] },
    { category: "法律", question: "GDPR 主要保护什么", expectedFacts: [ "个人数据", "数据主体", "控制者" ], forbiddenClaims: [ "适用于全世界所有数据" ] },
    { category: "法律", question: "正当程序的核心要求是什么", expectedFacts: [ "程序", "告知", "申辩" ], forbiddenClaims: [ "保证当事人一定胜诉" ] },
    { category: "历史", question: "活字印刷为什么改变了知识传播", expectedFacts: [ "复制", "成本", "传播" ], forbiddenClaims: [ "由一人独立发明并立即普及全球" ] },
    { category: "历史", question: "工业革命为什么首先在英国发生", expectedFacts: [ "多重因素", "资本", "能源" ], forbiddenClaims: [ "只有一个原因" ] },
    { category: "工程", question: "PDN 在芯片中负责什么", expectedFacts: [ "PDN", "Power Delivery Network", "供电", "压降" ], forbiddenClaims: [ "只是一根电源线" ] },
    { category: "工程", question: "TSV 在三维集成电路中起什么作用", expectedFacts: [ "TSV", "Through-Silicon Via", "垂直", "互连" ], forbiddenClaims: [ "平面金属走线" ] },
    { category: "体系结构", question: "缓存一致性解决什么问题", expectedFacts: [ "缓存", "副本", "一致" ], forbiddenClaims: [ "等同于数据库事务一致性" ] },
    { category: "网络", question: "背压机制如何防止接收方过载", expectedFacts: [ "接收方", "发送方", "速率" ], forbiddenClaims: [ "无限增加缓冲区" ] },
    { category: "跨语言", question: "latency 在计算机系统中通常是什么意思", expectedFacts: [ "延迟", "时间" ], forbiddenClaims: [ "带宽" ] },
    { category: "长文理解", question: "根据材料判断方案 A 是否一定优于方案 B", context: "方案 A 延迟较低但功耗较高，方案 B 功耗较低但吞吐量也较低，材料没有给出统一权重", expectedFacts: [ "不能", "权重", "权衡" ], forbiddenClaims: [ "方案 A 一定更优" ] },
    { category: "长文理解", question: "根据材料计算方案 A 与方案 B 的平均功耗差", context: "相同条件下，方案 A 的平均功耗为 120 mW，方案 B 为 95 mW", expectedFacts: [ "25", "mW" ], forbiddenClaims: [ "25%" ] },
    { category: "协议", question: "HTTP/2 多路复用为什么能减少连接等待", expectedFacts: [ "流", "同一连接", "并发" ], forbiddenClaims: [ "完全消除队头阻塞" ] },
    { category: "协议", question: "QUIC 以什么形态运行在网络栈中", expectedFacts: [ "UDP", "用户态", "传输" ], forbiddenClaims: [ "TCP 扩展" ] },
    { category: "网络", question: "DNS 递归解析如何找到域名对应地址", expectedFacts: [ "递归", "根", "权威" ], forbiddenClaims: [ "一次广播给所有服务器" ] },
    { category: "网络", question: "TCP 流量控制与拥塞控制有什么区别", expectedFacts: [ "接收方", "网络", "窗口" ], forbiddenClaims: [ "两者完全相同" ] },
    { category: "身份认证", question: "OAuth 2.0 与 OpenID Connect 分别解决什么问题", expectedFacts: [ "授权", "身份", "令牌" ], forbiddenClaims: [ "OAuth 2.0 本身就是登录协议" ] },
    { category: "安全", question: "JWT 具体是什么形态", expectedFacts: [ "令牌", "字符串", "签名" ], forbiddenClaims: [ "加密后的用户密码" ] },
    { category: "安全", question: "XSS 与 CSRF 利用的信任关系有什么不同", expectedFacts: [ "脚本", "浏览器", "登录状态" ], forbiddenClaims: [ "两者攻击方式完全相同" ] },
    { category: "数据库", question: "B 树索引为什么适合磁盘数据库", expectedFacts: [ "分支", "磁盘", "访问次数" ], forbiddenClaims: [ "每次查询只访问一个节点" ] },
    { category: "数据库", question: "MVCC 如何让读取与写入减少互相阻塞", expectedFacts: [ "版本", "快照", "事务" ], forbiddenClaims: [ "完全不需要并发控制" ] },
    { category: "软件工程", question: "幂等接口是什么意思", expectedFacts: [ "重复", "结果", "状态" ], forbiddenClaims: [ "只能调用一次" ] },
    { category: "操作系统", question: "虚拟内存如何把地址映射到物理内存", expectedFacts: [ "页表", "虚拟地址", "物理" ], forbiddenClaims: [ "每个进程直接使用全部物理地址" ] },
    { category: "体系结构", question: "NUMA 为什么会出现本地与远端内存延迟差异", expectedFacts: [ "处理器", "内存控制器", "互连" ], forbiddenClaims: [ "所有内存访问延迟相同" ] },
    { category: "运行时", question: "垃圾回收器如何判断对象可以回收", expectedFacts: [ "可达", "根", "引用" ], forbiddenClaims: [ "引用计数是唯一方法" ] },
    { category: "分布式系统", question: "CRDT 为什么能在并发更新后合并", expectedFacts: [ "合并", "并发", "收敛" ], forbiddenClaims: [ "不需要任何设计约束" ] },
    { category: "分布式系统", question: "最终一致性承诺了什么，又没有承诺什么", expectedFacts: [ "更新停止", "收敛", "立即" ], forbiddenClaims: [ "每次读取都立即得到最新值" ] },
    { category: "机器学习", question: "反向传播如何计算各层参数的梯度", expectedFacts: [ "链式法则", "损失", "梯度" ], forbiddenClaims: [ "直接搜索全部参数组合" ] },
    { category: "机器学习", question: "注意力机制如何决定不同输入的重要程度", expectedFacts: [ "查询", "键", "权重" ], forbiddenClaims: [ "始终选择一个输入" ] },
    { category: "机器学习", question: "精确率与召回率分别衡量什么", expectedFacts: [ "预测为正", "实际为正", "漏检" ], forbiddenClaims: [ "两个指标总是同时提高" ] },
    { category: "统计", question: "混杂变量为什么会扭曲因果判断", expectedFacts: [ "暴露", "结果", "共同原因" ], forbiddenClaims: [ "相关性自动证明因果" ] },
    { category: "医学", question: "随机对照试验为什么使用随机分组", expectedFacts: [ "随机", "混杂", "组间" ], forbiddenClaims: [ "保证每个个体都获益" ] },
    { category: "统计", question: "p 值具体回答的是什么问题", expectedFacts: [ "原假设", "数据", "极端" ], forbiddenClaims: [ "原假设为真的概率" ] },
    { category: "金融", question: "根据材料计算两年的复合年增长率", context: "一项投资从 100 万元增长到两年后的 121 万元", expectedFacts: [ "10%", "121", "100" ], forbiddenClaims: [ "21% 每年" ] },
    { category: "线性代数", question: "向量点积在几何上表示什么", expectedFacts: [ "夹角", "投影", "长度" ], forbiddenClaims: [ "叉积" ] },
    { category: "线性代数", question: "行列式为什么能反映线性变换的体积缩放", expectedFacts: [ "体积", "缩放", "符号" ], forbiddenClaims: [ "等于所有矩阵元素之和" ] },
    { category: "算法", question: "Dijkstra 算法为什么不能直接处理负权边", expectedFacts: [ "贪心", "最短距离", "负权" ], forbiddenClaims: [ "因为图中存在环" ] },
    { category: "算法", question: "快速排序在什么情况下会退化到平方复杂度", expectedFacts: [ "枢轴", "不平衡", "平方" ], forbiddenClaims: [ "任何输入都会退化" ] },
    { category: "信息论", question: "信息熵衡量的是什么", expectedFacts: [ "不确定性", "概率", "平均" ], forbiddenClaims: [ "数据文件的固定字节数" ] },
    { category: "信号处理", question: "傅里叶变换如何把时域信号表示为频率成分", expectedFacts: [ "时域", "频率", "基函数" ], forbiddenClaims: [ "删除所有噪声" ] },
    { category: "控制", question: "PID 积分饱和为什么会导致恢复迟缓", expectedFacts: [ "执行器", "积分", "累积" ], forbiddenClaims: [ "微分项持续累积" ] },
    { category: "电子工程", question: "晶体管如何在数字电路中充当开关", expectedFacts: [ "控制端", "导通", "截止" ], forbiddenClaims: [ "机械触点" ] },
    { category: "电子工程", question: "锁相环如何让输出频率跟踪参考信号", expectedFacts: [ "相位", "反馈", "振荡器" ], forbiddenClaims: [ "只比较电压幅度" ] },
    { category: "工程", question: "热失控为什么会形成正反馈", expectedFacts: [ "温度", "功耗", "正反馈" ], forbiddenClaims: [ "温度上升必然降低漏电" ] },
    { category: "医学", question: "疫苗如何形成免疫记忆", expectedFacts: [ "抗原", "免疫细胞", "记忆" ], forbiddenClaims: [ "直接杀死所有病原体" ] },
    { category: "医学", question: "胰岛素如何帮助降低血糖", expectedFacts: [ "葡萄糖", "细胞", "肝脏" ], forbiddenClaims: [ "把葡萄糖直接分解成胰岛素" ] },
    { category: "医学", question: "灵敏度与特异度分别表示什么", expectedFacts: [ "阳性", "阴性", "患病" ], forbiddenClaims: [ "等同于阳性预测值" ] },
    { category: "法律", question: "合理使用为什么不能只看是否营利", expectedFacts: [ "多因素", "用途", "市场" ], forbiddenClaims: [ "非营利就一定成立" ] },
    { category: "法律", question: "合同中的对价起什么作用", expectedFacts: [ "交换", "承诺", "可执行" ], forbiddenClaims: [ "任何赠与承诺都自动可执行" ] },
    { category: "法律", question: "制定法与判例法有什么区别", expectedFacts: [ "立法机关", "法院", "先例" ], forbiddenClaims: [ "判例法由行政机关制定" ] },
    { category: "历史", question: "法国大革命爆发有哪些相互作用的原因", expectedFacts: [ "财政", "社会", "政治" ], forbiddenClaims: [ "只有粮食短缺一个原因" ] },
    { category: "历史", question: "金本位如何约束货币发行", expectedFacts: [ "黄金", "兑换", "货币" ], forbiddenClaims: [ "政府可以无限发行而不受影响" ] },
    { category: "历史", question: "电报为什么缩短了远距离信息传播时间", expectedFacts: [ "电信号", "线路", "消息" ], forbiddenClaims: [ "依赖飞机运输" ] },
    { category: "生物", question: "光合作用如何把光能转化为化学能", expectedFacts: [ "光反应", "二氧化碳", "糖" ], forbiddenClaims: [ "只在夜间进行" ] },
    { category: "生物", question: "PCR 与 DNA 测序分别解决什么问题", expectedFacts: [ "扩增", "碱基顺序", "DNA" ], forbiddenClaims: [ "PCR 直接读出完整序列" ] },
    { category: "气候", question: "温室气体为什么会使地表增温", expectedFacts: [ "红外", "辐射", "能量" ], forbiddenClaims: [ "阻止所有太阳光进入" ] },
    { category: "跨语言", question: "latency 与 throughput 在系统性能中有什么区别", expectedFacts: [ "延迟", "吞吐量", "单位时间" ], forbiddenClaims: [ "两个词完全同义" ] }
];

const HOLDOUT_SEEDS: QualitySeed[] = [
    { category: "医学", question: "NMR 如何反映分子结构", expectedFacts: [ "磁场", "共振", "分子结构" ] },
    { category: "标准", question: "MIDI 传输的是什么", expectedFacts: [ "音符", "控制", "时序" ], forbiddenClaims: [ "直接传输声音波形" ] },
    { category: "数据库", question: "ACID 能否保证所有硬件故障都不丢数据", expectedFacts: [ "不能", "持久性", "刷盘" ], forbiddenClaims: [ "保证所有硬件故障都不丢数据" ] },
    { category: "体系结构", question: "SRAM 与 DRAM 的存储方式有什么区别", expectedFacts: [ "双稳态", "电容", "刷新" ] },
    { category: "数据库", question: "SQL 与 NoSQL 的核心区别是什么", expectedFacts: [ "数据模型", "具体产品" ], forbiddenClaims: [ "只能垂直扩展", "通常不支持 ACID" ] },
    { category: "协议", question: "CXL.cache 与 CXL.mem 分别负责什么", expectedFacts: [ "缓存一致性", "内存" ] },
    { category: "系统", question: "Docker 镜像和容器有什么区别", expectedFacts: [ "只读", "运行实例" ] },
    { category: "系统", question: "Kubernetes Pod 是什么", expectedFacts: [ "最小", "容器", "网络" ] },
    { category: "工具", question: "Git rebase 会怎样改写提交历史", expectedFacts: [ "基底", "重放", "提交" ] },
    { category: "安全", question: "TLS 握手完成了哪些工作", expectedFacts: [ "身份", "密钥", "参数" ] },
    { category: "分布式系统", question: "CAP 定理到底限制了什么", expectedFacts: [ "网络分区", "一致性", "可用性" ], forbiddenClaims: [ "三者永远只能选择两个" ] },
    { category: "算法", question: "FFT 为什么比直接计算 DFT 更快", expectedFacts: [ "分解", "复杂度", "n log n" ] },
    { category: "机器学习", question: "梯度下降如何更新参数", expectedFacts: [ "梯度", "学习率", "损失" ] },
    { category: "机器学习", question: "过拟合为什么会降低泛化能力", expectedFacts: [ "训练数据", "噪声", "新数据" ] },
    { category: "统计", question: "p 值不表示什么", expectedFacts: [ "原假设", "数据", "概率" ], forbiddenClaims: [ "原假设为真的概率" ] },
    { category: "统计", question: "置信区间应如何解释", expectedFacts: [ "重复抽样", "覆盖" ], forbiddenClaims: [ "参数有 95% 概率位于已算出的区间" ] },
    { category: "医学", question: "mRNA 疫苗如何诱导免疫反应", expectedFacts: [ "mRNA", "抗原", "免疫" ] },
    { category: "生物", question: "CRISPR-Cas9 如何定位并切割 DNA", expectedFacts: [ "向导 RNA", "Cas9", "DNA" ] },
    { category: "法律", question: "侵权法中的过失通常包含哪些要件", expectedFacts: [ "注意义务", "违反", "因果", "损害" ] },
    { category: "法律", question: "合理使用是否只要非营利就成立", expectedFacts: [ "不是", "多因素" ], forbiddenClaims: [ "非营利就一定属于合理使用" ] },
    { category: "历史", question: "布雷顿森林体系建立了什么货币安排", expectedFacts: [ "美元", "黄金", "汇率" ] },
    { category: "电子工程", question: "晶体管如何作为开关工作", expectedFacts: [ "控制", "电流", "导通" ] },
    { category: "控制", question: "PID 控制器的三个项分别解决什么", expectedFacts: [ "比例", "积分", "微分" ] },
    { category: "并发", question: "互斥锁与信号量有什么区别", expectedFacts: [ "互斥", "计数", "资源" ] },
    { category: "跨语言", question: "throughput 在系统性能中通常是什么意思", expectedFacts: [ "吞吐量", "单位时间" ], forbiddenClaims: [ "单次请求延迟" ] }
];

function visibleQuestions(question: string): string[] {
    const base = question.replace(/[？?]+$/u, "");
    return [
        `${base}？`,
        `请直接说明：${base}？`
    ];
}

function holdoutQuestions(question: string): string[] {
    const base = question.replace(/[？?]+$/u, "");
    return [ `${base}？`, `请用通俗语言回答：${base}？` ];
}

function expectedIntentFor(question: string): NonNullable<ReadWeaveHarnessCase["expectedIntent"]> {
    if (/(?:是谁|是何人|人物|个人简介)/u.test(question)) return "identity";
    if (/(?:具体.*(?:形态|形式)|以什么.*存在)/u.test(question)) return "form";
    if (/(?:如何工作|怎么工作|工作原理|如何实现|怎么实现|如何形成|如何更新|怎样形成|如何定位|如何诱导|如何作为)/u.test(question)) return "mechanism";
    if (/(?:为什么|为何|原因)/u.test(question)) return "reason";
    if (/(?:区别|比较|差异|有什么不同|分别)/u.test(question)) return "comparison";
    if (/(?:计算|多少|相差|增幅|降幅)/u.test(question)) return "calculation";
    if (/(?:能否|是否一定|是否只要|能不能保证|限制了什么|不表示什么|应如何解释)/u.test(question)) return "boundary";
    return "definition";
}

function buildCases(seeds: QualitySeed[], variants: (question: string) => string[], prefix: string): ReadWeaveHarnessCase[] {
    return seeds.flatMap((seed, seedIndex) => variants(seed.question).map((question, variantIndex) => ({
        caseId: `${prefix}-${String(seedIndex + 1).padStart(2, "0")}-${variantIndex + 1}`,
        category: seed.category,
        question,
        context: seed.context,
        expectedFacts: seed.expectedFacts,
        forbiddenClaims: seed.forbiddenClaims ?? [],
        critical: true,
        expectedIntent: expectedIntentFor(seed.question)
    })));
}

export const READWEAVE_VISIBLE_QUALITY_CASES = buildCases(VISIBLE_SEEDS, visibleQuestions, "quality");
export const READWEAVE_HOLDOUT_QUALITY_CASES = buildCases(HOLDOUT_SEEDS, holdoutQuestions, "holdout");

if (READWEAVE_VISIBLE_QUALITY_CASES.length < 150 || READWEAVE_HOLDOUT_QUALITY_CASES.length !== 50) {
    throw new Error("ReadWeave quality corpus must contain at least 150 visible and exactly 50 holdout cases");
}
