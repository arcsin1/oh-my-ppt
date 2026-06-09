# CLAUDE.md

## Project

Oh My PPT — 本地优先的 AI 幻灯片生成与编辑工具。Electron + React + TypeScript。

## Commands

```bash
pnpm dev          # 开发
pnpm build        # 不要跑构建
pnpm run typecheck:node # 跑 node 类型检查
pnpm run typecheck:web # 跑 renderer 类型检查
pnpm typecheck    # 跑类型检查  
pnpm lint         # 不要跑ESLint
pnpm format       # 不要跑Prettier
```

> 不要跑 `npm run lint` / `npm run build`。

## Code Style

- Prettier: `singleQuote`, `no semi`, `printWidth: 100`, `trailingComma: none`
- 路径别名: `@shared/*` → `src/shared/*`, `@renderer/*` → `src/renderer/src/*`

## Execution Rules

- 先判断问题落在哪条链路：生成、编辑、导入、导出或运行时；不要只修当前可见入口
- 公共规则变更要确认生成和编辑都覆盖，包括整页编辑、deck 编辑、selector 编辑
- 改 runtime asset 时，同步检查 session asset 兼容/刷新机制
- 修 bug 优先补最小定向回归测试，必要时覆盖相邻入口
- 验证时跑最相关的最小测试集；不要跑 `npm run lint` 或 `npm run build`

## Testing

- 框架：Vitest + happy-dom，测试文件放 `tests/unit/` 下，按功能域分子目录，文件名 `*.test.ts`
- 跑测试：`pnpm test`，跑单个文件：`pnpm test -- tests/unit/xxx/foo.test.ts`
- 修 bug 或加功能时，必须补对应测试到 `tests/unit/`；测试不通过就继续修代码直到通过

##  React 组件编写规范

### 核心原则

#### 1. 逻辑内聚，少传 props
- **能写在组件内的逻辑就写在组件内**，不要通过 props 从父组件传进来
- 事件处理、数据获取、状态管理，都优先写在组件自己里面

```jsx
// ✅ 好
function ProductCard({ id }) {
  const [count, setCount] = useState(0)
  const handleBuy = () => { /* 逻辑写这里 */ }
  return <button onClick={handleBuy}>购买</button>
}

// ❌ 坏
function ProductCard({ count, onBuy }) { /* 逻辑都从外面传 */ }
```

#### 2. 跨组件状态用 Zustand
- 多个组件需要共享的数据 → 放 zustand store
- 不要通过 props 一层层传

```jsx
const useStore = create((set) => ({
  user: null,
  setUser: (user) => set({ user })
}))

// 任何组件直接拿来用，不用传 props
const user = useStore(state => state.user)
```

####  3. 复用逻辑抽成自定义 Hook
- 多个组件都需要**相同的有状态逻辑**时，抽成自定义 Hook
- Hook 放在 `hooks/` 目录下，以 `use` 开头

```jsx
// hooks/useProductData.js
function useProductData(productId) {
  const [product, setProduct] = useState(null)
  const [loading, setLoading] = useState(false)
  
  useEffect(() => {
    fetchProduct(productId).then(setProduct)
  }, [productId])
  
  return { product, loading }
}

// 组件中使用
function ProductCard({ id }) {
  const { product, loading } = useProductData(id)
  // 不用从 props 传 product 和 loading
}
```

#### 4. 什么情况才用 props？
只传这两类东西：
- **配置项**：`size`, `disabled`, `variant`
- **纯展示数据**：`title`, `description`

## 简单检查
写代码前问一句：*"这个逻辑/状态能不能直接写在当前组件里？"*
- 能 → 就写里面
- 不能，但多个组件都需要 → 放 zustand 或抽成自定义 Hook
- 实在不行 → 才传 props

## 记住
**组件要自己管自己，别当父组件的提线木偶。**

