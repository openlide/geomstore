# GeomStore

<p align="center">
  <strong>轻量级微信小程序状态管理库</strong>
</p>

<p align="center">
  简洁 · 高效 · 易用 · 企业级
</p>

<p align="center">
  <a href="#特性">特性</a> •
  <a href="#安装">安装</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#文档">文档</a> •
  <a href="#示例">示例</a>
</p>

---

## 特性

### 🎯 核心特性

- **简洁易用的 API** - 类似 Pinia 的设计理念，学习成本极低
- **完整的 TypeScript 支持** - 开箱即用的类型推断，无需额外配置
- **高性能设计** - LRU 缓存、批量更新、高效的状态变更检测
- **零外部依赖** - 纯原生实现，包体积极小

### 🚀 企业级功能

- **Store 组合** - 模块化管理大型应用状态，支持命名空间
- **插件系统** - 内置日志、持久化、DevTools、时间旅行等插件
- **错误处理** - 完善的错误边界、恢复策略、监控上报系统
- **性能监控** - 实时性能指标收集、分析与优化工具
- **快照系统** - 状态快照、对比、异步克隆与时间旅行调试
- **Action 增强** - 内置装饰器：日志、防抖、节流、缓存、重试、超时

### 📱 微信小程序优化

- **原生集成** - `withPageStore`、`withComponentStore`、`withAppStore` 一键连接
- **Skyline 支持** - 完美支持新一代渲染引擎
- **按需注入** - 配合小程序分包优化

---

## 安装

### 方式一：复制文件（推荐小程序项目）

将 `dist` 文件夹复制到小程序项目：

```
小程序项目/
└── utils/
    └── geomstore/
        └── dist/
```

```javascript
const { createStore } = require('./utils/geomstore/dist/index.js')
```

### 方式二：NPM 安装

```bash
npm install @openlide/geomstore
```

```javascript
import { createStore } from '@openlide/geomstore'
```

---

## 快速开始

### 创建 Store

```javascript
const { createStore } = require('./utils/geomstore')

// 创建用户状态管理
const useUserStore = createStore({
  name: 'user',

  state: {
    userInfo: null,
    token: '',
    isLoggedIn: false
  },

  actions: {
    // 登录（action 通过 this.state 读写状态，参数为调用时传入）
    async login(credentials) {
      const res = await wx.request({
        url: '/api/login',
        method: 'POST',
        data: credentials
      })

      this.state.userInfo = res.data.user
      this.state.token = res.data.token
      this.state.isLoggedIn = true
    },

    // 登出
    logout() {
      this.state.userInfo = null
      this.state.token = ''
      this.state.isLoggedIn = false
    },

    // 更新用户信息
    updateProfile(profile) {
      this.state.userInfo = { ...this.state.userInfo, ...profile }
    }
  },

  getters: {
    // 是否 VIP 用户
    isVip(state) {
      return state.userInfo?.vipLevel > 0
    },

    // 用户显示名称
    displayName(state) {
      return state.userInfo?.nickname || '未登录'
    }
  }
})
```

### 连接小程序页面

```javascript
// pages/index/index.js
const { withPageStore } = require('../../utils/geomstore')

// 获取全局 store
const app = getApp()
const userStore = app.userStore

Page(withPageStore(userStore, {
  // 映射状态到页面 data
  mapState: ['userInfo', 'isLoggedIn'],
  // 映射 getters
  mapGetters: ['isVip', 'displayName'],
  // 映射 actions
  mapActions: ['login', 'logout', 'updateProfile']
})({
  data: {
    // 页面私有数据
    loading: false
  },

  onLoad() {
    // 直接访问映射的状态
    console.log(this.data.userInfo)
    console.log(this.data.displayName)

    // 直接调用映射的 actions
    this.handleLogin()
  },

  async handleLogin() {
    this.setData({ loading: true })
    try {
      await this.login({ username: 'test', password: '123456' })
      wx.showToast({ title: '登录成功', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: '登录失败', icon: 'error' })
    } finally {
      this.setData({ loading: false })
    }
  },

  handleLogout() {
    this.logout()
    wx.showToast({ title: '已退出登录' })
  }
}))
```

### 连接小程序组件

```javascript
// components/user-card/index.js
const { withComponentStore } = require('../../utils/geomstore')

Component(withComponentStore(userStore, {
  mapState: ['userInfo'],
  mapGetters: ['displayName', 'isVip']
})({
  properties: {
    // 组件属性
    showVipBadge: {
      type: Boolean,
      value: true
    }
  },

  methods: {
    onTap() {
      this.triggerEvent('userTap', this.data.userInfo)
    }
  }
}))
```

---

## 文档

| 文档                                                  | 说明                                   |
| ----------------------------------------------------- | -------------------------------------- |
| [入门指南](docs/GUIDE.md)                             | 详细的安装配置与基础用法               |
| [核心概念](docs/CONCEPTS.md)                          | Store、Actions、Getters 等核心概念解析 |
| [架构设计](docs/ARCHITECTURE.md)                      | 系统架构与模块设计文档                 |
| [API 参考](docs/API.md)                               | 完整的 API 接口文档                    |
| [最佳实践](docs/BEST_PRACTICES.md)                    | 开发建议与性能优化指南                 |
| [常见问题](docs/FAQ.md)                               | 常见问题解答                           |
| [生产可行性评审](docs/PRODUCTION_READINESS_REPORT.md) | 企业级生产环境部署评审报告             |
| [技术文档](docs/TECHNICAL_DOCUMENTATION.md)           | 完整技术规范文档                       |

---

## 示例

### 购物车示例

```javascript
const useCartStore = createStore({
  name: 'cart',

  state: {
    items: [],
    selectedIds: new Set()
  },

  actions: {
    addItem(product) {
      const existing = this.state.items.find(item => item.id === product.id)
      if (existing) {
        existing.quantity++
      } else {
        this.state.items.push({ ...product, quantity: 1 })
      }
    },

    removeItem(productId) {
      const index = this.state.items.findIndex(item => item.id === productId)
      if (index > -1) {
        this.state.items.splice(index, 1)
      }
    },

    updateQuantity(productId, quantity) {
      const item = this.state.items.find(item => item.id === productId)
      if (item) {
        item.quantity = Math.max(1, quantity)
      }
    },

    toggleSelect(productId) {
      if (this.state.selectedIds.has(productId)) {
        this.state.selectedIds.delete(productId)
      } else {
        this.state.selectedIds.add(productId)
      }
    },

    clearCart() {
      this.state.items = []
      this.state.selectedIds = new Set()
    }
  },

  getters: {
    // 总数量
    totalCount(state) {
      return state.items.reduce((sum, item) => sum + item.quantity, 0)
    },

    // 总价格
    totalPrice(state) {
      return state.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    },

    // 已选商品
    selectedItems(state) {
      return state.items.filter(item => state.selectedIds.has(item.id))
    },

    // 已选商品总价
    selectedTotalPrice(state) {
      return state.items
        .filter(item => state.selectedIds.has(item.id))
        .reduce((sum, item) => sum + item.price * item.quantity, 0)
    }
  }
})
```

### 使用插件

```javascript
const { createStore, loggerPlugin, persistencePlugin, devtoolsPlugin } = require('./utils/geomstore')

const store = createStore({
  name: 'app',
  state: { /* ... */ },
  actions: { /* ... */ }
})

// 安装日志插件
store.use(loggerPlugin)

// 安装持久化插件
store.use(persistencePlugin({
  key: 'app-state',
  storage: wx.storage
}))

// 安装开发工具（仅开发环境）
if (__DEV__) {
  store.use(devtoolsPlugin)
}
```

---

## 平台支持

| 平台               | 支持版本       |
| ------------------ | -------------- |
| 微信小程序         | 基础库 3.10.0+ |
| 微信小程序 Skyline | 完全支持       |

---

## 目录结构

```
GeomStore/
├── dist/                    # 编译产物
│   ├── index.js             # 入口文件
│   ├── index.d.ts           # 类型声明
│   ├── core/                # 核心模块
│   ├── plugins/             # 插件
│   └── integrations/        # 集成模块
├── src/                     # 源代码
│   ├── core/                # 核心实现
│   │   ├── store/           # Store 类
│   │   ├── cache/           # LRU 缓存
│   │   ├── selector/        # 选择器
│   │   ├── error/           # 错误处理
│   │   ├── action/          # Action 增强
│   │   ├── snapshot/        # 快照系统
│   │   ├── compose/         # Store 组合
│   │   ├── performance/     # 性能监控
│   │   └── utils/           # 工具函数
│   ├── plugins/             # 插件实现
│   ├── integrations/        # 小程序集成
│   └── types/               # 类型定义
├── tests/                   # 测试用例
├── docs/                    # 文档
└── package.json
```

---

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 测试
npm test

# 类型检查
npm run typecheck

# 代码检查
npm run lint
```

---

## 贡献

欢迎提交 Issue 和 Pull Request！

---

## 许可证

[MIT](LICENSE)

---

## 致谢

灵感来源于：
- [Pinia](https://pinia.vuejs.org/) - Vue 官方状态管理
- [Zustand](https://github.com/pmndrs/zustand) - 极简状态管理
- [Redux](https://redux.js.org/) - 可预测状态容器
