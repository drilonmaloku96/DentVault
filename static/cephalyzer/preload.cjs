const { contextBridge, ipcRenderer } = require('electron')

// Platform-specific performance optimizations
if (process.platform === 'win32') {
  // Windows performance optimizations
  // Note: process.setpriority not available in Electron Windows
  console.log('Windows platform detected in preload')
  
  // Windows-specific V8 optimizations
  if (global.gc) {
    setInterval(() => {
      global.gc()
    }, 25000) // More frequent GC for Windows
  }
} else if (process.platform === 'darwin' && process.arch === 'x64') {
  // Intel Mac performance optimizations
  // Note: process.setpriority may not be available in sandboxed preload
  console.log('Intel Mac platform detected in preload')
  
  // Optimize V8 for Intel processors
  if (global.gc) {
    setInterval(() => {
      global.gc()
    }, 30000) // Run garbage collection every 30 seconds
  }
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  writeFile: (filePath, data) => ipcRenderer.invoke('write-file', filePath, data),
  writeBinaryFile: (filePath, base64Data) => ipcRenderer.invoke('write-binary-file', filePath, base64Data),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  
  // Menu event listeners
  onMenuSave: (callback) => ipcRenderer.on('menu-save', callback),
  onMenuExportPdf: (callback) => ipcRenderer.on('menu-export-pdf', callback),
  onFileOpened: (callback) => ipcRenderer.on('file-opened', callback),
  onCephFileOpened: (callback) => ipcRenderer.on('ceph-file-opened', callback),
  
  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  
  // Platform detection with architecture info
  platform: process.platform,
  arch: process.arch,
  isElectron: true,
  isIntelMac: process.platform === 'darwin' && process.arch === 'x64',
  isAppleSilicon: process.platform === 'darwin' && process.arch === 'arm64',
  isWindows: process.platform === 'win32',
  cpuInfo: {
    cores: 'Unknown',
    model: 'Unknown', 
    totalMemory: 'Unknown'
  },
  
  // Performance helpers
  requestIdleCallback: (callback, timeout = 5000) => {
    if (typeof requestIdleCallback !== 'undefined') {
      return requestIdleCallback(callback, { timeout })
    } else {
      return setTimeout(callback, 0)
    }
  },
  
  // Memory management
  forceGC: () => {
    if (global.gc) {
      global.gc()
      return true
    }
    return false
  }
})