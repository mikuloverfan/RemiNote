# AI-Safe Code Writing Guard

防污染编码规范 — 适用于 AI 辅助开发的 TypeScript / Obsidian 插件项目。

---

## Rule 1: Zero Partial Code

**禁止：**
- 半行代码、未闭合字符串、未闭合括号
- `...rest of code unchanged` 省略写法
- diff 风格 `+` `-` patch 直接写入源码
- 依赖上下文补全的片段

**必须：**
- 每个代码块自身可独立编译
- 提供完整 function / class / block
- `apply_diff` 的 SEARCH 必须精确匹配（含空白），REPLACE 必须完整

```
// BAD
console.log('[TAG]', value  // half line

// GOOD
console.log('[TAG]', { key: value });
```

---

## Rule 2: No Unicode / Emoji Corruption

**禁止：**
- `�` (U+FFFD replacement character)
- 不可见控制字符 (U+200B zero-width space 等)
- 非标准 emoji 序列
- 文件中出现 `??` 乱码模式

**允许：**
- ASCII 0x20-0x7E
- UTF-8 标准可见字符
- 常见 Unicode 符号 (arrows, math, CJK)

**根因防御：**
- 禁止使用 PowerShell `Set-Content` 覆写 UTF-8 文件
- 禁止使用默认编码的命令行工具写文件
- 优先使用 `apply_diff` 工具进行修改（保持编码不变）

---

## Rule 3: Logging Standard

```typescript
// REQUIRED format
console.log('[TAG]', { key: value });
console.warn('[TAG]', { key: value });
console.error('[TAG]', { key: value });

// FORBIDDEN
console.log('[TAG] value is ' + value);              // string concat
console.log('[TAG]', a, b, c, d);                    // multi-arg chaos
console.log('[TAG] broken string);                   // unterminated
console.log('emoji log tag', value);                 // emoji in tag
```

**TAG 命名：** 使用 `[A-Z]` 大写标识，如 `[REGISTRY]` `[SESSION]` `[ENGINE]` `[HEALTH]`。

---

## Rule 4: Whole Block Replacement Only

**禁止：**
- 单行修补 (`s/old/new`)
- AI diff patch 粘贴到源码
- 逐字符编辑

**必须：**
- 完整函数替换
- 完整 class 替换
- 完整 interface/type 替换
- SEARCH block 必须包含足够上下文使匹配唯一

---

## Rule 5: Build Safety Rule

每次修改后必须满足：

```
tsc --noEmit   # 0 errors
```

验证项：
- 无 `Unterminated string literal`
- 无 `Cannot find name`
- 无 `Property does not exist`
- 无 bracket/paren 不匹配
- 文件编码 UTF-8 clean（无 `0xEF 0xBF 0xBD` 序列）

---

## Rule 6: No "Fuzzy Fix"

**禁止：**
- "这里应该差不多"
- "可能需要补一个括号"
- "大概是这个意思"
- "类似这样"

**必须：**
- 精确的行号
- 精确的修改内容
- 修改前后完整对照

---

## Rule 7: File Write Safety

| 操作 | 安全 | 危险 |
|------|------|------|
| `apply_diff` | ✅ 保持编码 | — |
| `write_to_file` | ✅ 指定 UTF-8 | — |
| `execute_command` + `Set-Content` | — | ❌ 破坏编码 |
| `execute_command` + `Out-File` | — | ❌ 默认 UTF-16 |
| `execute_command` + `>` 重定向 | — | ❌ 编码不确定 |

**铁律：修改文件内容必须使用 `apply_diff` 或 `write_to_file`，禁止通过 shell 命令覆写。**

---

## Verification Checklist

每次 AI 输出代码前自检：

```
[ ] 所有字符串已闭合 ('' "" ``)
[ ] 所有括号配对 ({} [] ())
[ ] 无 U+FFFD replacement char
[ ] 无 ...rest of code 省略
[ ] 每段代码可独立编译
[ ] console 使用 '[TAG]' 格式
[ ] SEARCH block 精确匹配原始内容
[ ] REPLACE block 完整可编译
```

---

## Core Principle

> "AI 不允许生成无法直接编译的代码"
