# 🛡️ WatchDog Pro

**WatchDog Pro** is a high-performance, professional utility designed to monitor and automatically restart critical applications on your computer. Whether you're running a server, a background script, or a specific productivity tool, WatchDog Pro ensures it stays alive 24/7.

---

## 🎨 Premium Features

- **🚀 Smart Auto-Restart**: Instantly detects when a monitored application crashes or is closed, automatically relaunching it to minimize downtime.
- **📊 Individual Analytics**: Tracks a "Restart Count" for every application, giving you insights into which software is most unstable.
- **🔍 Advanced Search & Filter**: Easily manage dozens of processes with an integrated search bar and per-app history filtering.
- **🕒 Configurable Heartbeat**: Adjustable monitoring intervals (1s to 60s) to balance performance and responsiveness.
- **🧹 Automated Log Maintenance**: Built-in log rotation with configurable retention days to keep your system clean and lightweight.
- **🖥️ Minimalist Pro UI**: A clean, modern desktop aesthetic designed for power users and sysadmins.
- **📂 One-Click AppData Access**: Direct access to configuration and raw log files for easy backups.

---

## 🛠️ Technology Stack

WatchDog Pro is built using a modern, robust architecture:

- **Framework**: [Electron](https://www.electronjs.org/) (High-performance Desktop Environment)
- **Frontend**: [React](https://reactjs.org/) + [TypeScript](https://www.typescriptlang.org/)
- **Build Engine**: [Vite](https://vitejs.dev/) (Optimized bundling and HMR)
- **Styling**: Modern Vanilla CSS (Minimalist utility design)
- **Core Utilities**:
  - `ps-list`: Precision process detection.
  - `electron-log`: Reliable cross-thread logging.
  - `Inter`: Premium typography.
- **Packaging**: `electron-builder` (Portable and Installer support)

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/gowinda/watch-dog.git
   cd watch-dog
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

### Development
Run the application in development mode:
```bash
npm run dev
```

### Build Executable
Generate a professional installer/portable `.exe` file for Windows:
```bash
npm run build
```

---

## 🛡️ License & Copyright

**WatchDog Pro** © 2026 by **gowinda**. All rights reserved.

Licensed for personal and professional use. No part of this software may be reproduced or distributed without explicit permission from the author.

---

*“Stay running. Stay stable. WatchDog Pro.”*
