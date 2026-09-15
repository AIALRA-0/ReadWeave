const EXPLICIT_PERSON_INTENT =
    /(?:是谁|谁是|是何人|什么人|个人简介|个人资料|(?:他的|她的|此人的|其个人的|[”"'’]\s*的?)身份|现任(?:什么|哪里|哪家|何种)?(?:职位|职务|机构)?|任职(?:于|哪里|哪家)?|履历|生平|简历|\bwho\s+is\b|\bwho\s+was\b|\bbiograph(?:y|ical)\b|\bcurrent\s+(?:role|position|affiliation)\b|\bperson(?:al)?\s+profile\b)/iu;
const PERSON_ATTRIBUTE_INTENT =
    /(?:他的|她的|此人的|其个人的)?(?:背景资料|教育背景|职业背景|研究方向|专业领域|工作经历)|\b(?:research\s+interests?|professional\s+background|employment\s+history)\b/iu;
const COMMON_CHINESE_SURNAMES = new Set(
    Array.from(
        "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房裘缪干解应宗丁宣邓郁单杭洪包"
    )
);
const COMPOUND_CHINESE_SURNAMES = [
    "诸葛",
    "欧阳",
    "司马",
    "上官",
    "东方",
    "皇甫",
    "尉迟",
    "公孙"
];
const TECHNICAL_NAME_ENDINGS =
    /(?:方法|算法|模型|系统|网络|过程|工程|技术|背景|方向|领域|单元|电路|芯片|布局|验证|身份|函数|协议|格式|架构|接口|数据|语言|理论|定理|问题|分析|设计|优化)$/u;

function quotedSubject(question: string): string | undefined {
    return question.match(/[“"'‘]([^”"'’\n]{2,120})[”"'’]/u)?.[1]?.trim();
}

function explicitSubject(question: string): string | undefined {
    return (
        question
            .match(
                /([\p{Script=Han}·]{2,20})(?=\s*(?:是谁|是何人|什么人|人物|个人简介|个人资料|身份|现任|任职|履历|生平|简历))/u
            )?.[1]
            ?.trim() ??
        question
            .match(
                /\b[A-Za-z][A-Za-z0-9'’._-]{1,40}(?:\s+[A-Za-z][A-Za-z0-9'’._-]{1,40}){0,5}(?=\s*(?:是谁|是何人|什么人|人物|个人简介|个人资料|身份|现任|任职|履历|生平|简历))/iu
            )?.[0]
            ?.trim() ??
        question
            .match(/(?:谁是|何人是)\s*([\p{Script=Han}·]{2,20})/u)?.[1]
            ?.trim() ??
        question
            .match(
                /(?:谁是|何人是)\s*([A-Za-z][A-Za-z0-9'’._-]{1,40}(?:\s+[A-Za-z][A-Za-z0-9'’._-]{1,40}){0,5})/iu
            )?.[1]
            ?.replace(/[?？,，;；:：]+$/u, "")
            .trim() ??
        question
            .match(
                /\bwho\s+(?:is|was)\s+([A-Za-z][A-Za-z0-9'’._-]{1,40}(?:\s+[A-Za-z][A-Za-z0-9'’._-]{1,40}){0,5})/iu
            )?.[1]
            ?.replace(/[?？,，;；:：]+$/u, "")
            .trim()
    );
}

function leadingSubject(question: string): string | undefined {
    return (
        question
            .match(
                /^\s*([\p{Script=Han}·]{2,8}?)(?=\s*(?:的)?(?:背景资料|教育背景|职业背景|研究方向|专业领域|工作经历))/u
            )?.[1]
            ?.trim() ??
        question
            .match(
                /^\s*([A-Za-z][A-Za-z0-9'’._-]{1,40}(?:\s+[A-Za-z][A-Za-z0-9'’._-]{1,40}){1,5})(?=\s*(?:的|\b)(?:背景资料|教育背景|职业背景|研究方向|专业领域|工作经历|research\s+interests?|professional\s+background|employment\s+history))/iu
            )?.[1]
            ?.trim()
    );
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function looksLikePersonName(value: string): boolean {
    const trimmed = value.trim();
    const compoundSurname = COMPOUND_CHINESE_SURNAMES.find((surname) =>
        trimmed.startsWith(surname)
    );
    const chineseNameLength = Array.from(trimmed).length;
    const isPlausibleChineseName =
        /^[\p{Script=Han}·]+$/u.test(trimmed) &&
        !TECHNICAL_NAME_ENDINGS.test(trimmed) &&
        (compoundSurname
            ? chineseNameLength >= 3 && chineseNameLength <= 5
            : COMMON_CHINESE_SURNAMES.has(Array.from(trimmed)[0] ?? "") &&
              chineseNameLength >= 2 &&
              chineseNameLength <= 4);
    return (
        isPlausibleChineseName ||
        /^[A-Za-z][A-Za-z0-9'’._-]{1,40}(?:\s+[A-Za-z][A-Za-z0-9'’._-]{1,40}){1,5}$/u.test(
            trimmed
        )
    );
}

function hasDirectPersonPredicate(subject: string, context: string): boolean {
    if (!context.trim() || !looksLikePersonName(subject)) return false;
    const normalized = context
        .normalize("NFKC")
        .replace(/<\/(?:p|li|h[1-6]|div|tr|td|th|section|article)>/giu, "\n")
        .replace(/<[^>]*>/gu, " ")
        .replace(/[^\S\r\n]+/gu, " ");
    const name = escapeRegExp(subject);
    const role =
        "(?:教授|学者|研究者|科学家|工程师|院士|博士生|博士后|教师|作者|\\bprofessor\\b|\\bresearcher\\b|\\bscientist\\b|\\bengineer\\b|\\bfaculty\\b|\\bauthor\\b)";
    const forward = new RegExp(
        `${name}[^。；;\\n]{0,72}(?:是|为|现任|任职|任教|works?\\s+as|is\\s+an?)[^。；;\\n]{0,48}${role}`,
        "iu"
    );
    const reverse = new RegExp(`${role}[^。；;\\n]{0,48}${name}`, "iu");
    return forward.test(normalized) || reverse.test(normalized);
}

/**
 * Article context may disambiguate a person already named by the question, but
 * only a direct local predicate may create person intent for the Definition
 * action. Academic articles routinely contain authors, professors and
 * affiliations elsewhere near ordinary quoted terms.
 */
export function readWeavePersonSubject(
    question: string,
    context = ""
): string | undefined {
    const normalized = question.normalize("NFKC").replace(/\s+/gu, " ").trim();
    const hasExplicitIntent = EXPLICIT_PERSON_INTENT.test(normalized);
    const hasAttributeIntent = PERSON_ATTRIBUTE_INTENT.test(normalized);
    const subject =
        quotedSubject(normalized) ??
        explicitSubject(normalized) ??
        (hasAttributeIntent ? leadingSubject(normalized) : undefined);
    const cleaned = subject?.replace(/[？?，,：:；;]+$/gu, "").trim();
    if (!cleaned) return undefined;
    if (hasExplicitIntent) return cleaned;
    if (hasAttributeIntent && looksLikePersonName(cleaned)) return cleaned;

    // The Definition action may be used on a person's name. Permit that only
    // when the same local clause directly identifies the selected name as a
    // person. A professor or author elsewhere in the article is irrelevant.
    return hasDirectPersonPredicate(cleaned, context) ? cleaned : undefined;
}

export function isReadWeavePersonProfileQuery(query: string): boolean {
    const normalized = query.normalize("NFKC");
    return /(?:官方主页[^\n]{0,30}(?:大学|教授|职位|研究方向)|official\s+(?:person(?:al)?\s+)?profile[^\n]{0,50}(?:research\s+interests?|affiliation)|researcher\s+profile[^\n]{0,50}(?:current\s+)?affiliation)/iu.test(
        normalized
    );
}
