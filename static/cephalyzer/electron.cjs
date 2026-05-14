const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs').promises
const fsSync = require('fs')
const os = require('os')
const http = require('http')
const isDev = process.env.NODE_ENV === 'development'

// Add global error handlers to debug startup issues
const logToFile = (message) => {
  try {
    const logPath = path.join(os.tmpdir(), 'cephalometric-debug.log')
    const timestamp = new Date().toISOString()
    const logMessage = `[${timestamp}] ${message}\n`
    
    // Console output
    console.log(message)
    
    // File output for debugging
    try {
      fsSync.appendFileSync(logPath, logMessage)
    } catch (fileError) {
      console.log('Could not write to log file:', fileError.message)
    }
  } catch (error) {
    console.log('Logging error:', error.message, '- Original message:', message)
  }
}

logToFile('=== CEPHALOMETRIC ANALYZER STARTUP ===')
logToFile(`Platform: ${process.platform}`)
logToFile(`Electron version: ${process.versions.electron}`)
logToFile(`Node version: ${process.versions.node}`)
logToFile(`Process argv: ${process.argv.join(' ')}`)

process.on('uncaughtException', (error) => {
  const message = `Uncaught Exception: ${error.message}\nStack: ${error.stack}`
  logToFile(message)
  console.error(message)
})

process.on('unhandledRejection', (reason, promise) => {
  const message = `Unhandled Rejection: ${reason}`
  logToFile(message)
  console.error(message)
})

// Keep a global reference of the window object
let mainWindow
let tempDistPath = null
let localServer = null
let serverPort = null

// Create local HTTP server for Windows
async function createLocalServer(distPath) {
  if (!distPath || localServer) return null
  
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        console.log('Windows server: Request for', req.url)
        
        let filePath = req.url === '/' ? '/index.html' : req.url
        const fullPath = path.join(distPath, filePath)
        
        // Security check - ensure file is within dist directory
        const normalizedPath = path.resolve(fullPath)
        const normalizedDist = path.resolve(distPath)
        if (!normalizedPath.startsWith(normalizedDist)) {
          res.writeHead(403)
          res.end('Forbidden')
          return
        }
        
        // Check if file exists
        if (!fsSync.existsSync(fullPath)) {
          res.writeHead(404)
          res.end('Not Found')
          return
        }
        
        // Read and serve file
        const content = await fs.readFile(fullPath)
        const ext = path.extname(fullPath)
        
        // Set appropriate content type
        let contentType = 'text/plain'
        if (ext === '.html') contentType = 'text/html'
        else if (ext === '.js') contentType = 'application/javascript'
        else if (ext === '.css') contentType = 'text/css'
        else if (ext === '.json') contentType = 'application/json'
        
        res.writeHead(200, { 
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Cache-Control': 'no-cache'
        })
        res.end(content)
        
      } catch (error) {
        console.error('Windows server error:', error)
        res.writeHead(500)
        res.end('Internal Server Error')
      }
    })
    
    // Find available port starting from 8080
    let port = 8080
    const tryPort = () => {
      server.listen(port, '127.0.0.1', () => {
        console.log(`Windows: Local server started on http://127.0.0.1:${port}`)
        localServer = server
        serverPort = port
        resolve(port)
      })
      
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          port++
          if (port > 8090) {
            reject(new Error('No available ports'))
            return
          }
          server.close()
          setTimeout(tryPort, 100)
        } else {
          reject(err)
        }
      })
    }
    
    tryPort()
  })
}

// Windows-specific function to extract dist files from asar
async function extractDistForWindows() {
  if (process.platform !== 'win32' || isDev) return null
  
  try {
    const asar = require('@electron/asar')
    const tempDir = path.join(os.tmpdir(), 'cephalometric-analyzer-' + Date.now())
    
    console.log('Windows: Extracting dist files to:', tempDir)
    
    // Create temp directory
    await fs.mkdir(tempDir, { recursive: true })
    
    // Extract only the dist folder from asar
    const asarPath = path.join(app.getAppPath(), 'dist')
    const tempDistDir = path.join(tempDir, 'dist')
    
    // Check if we can read from asar
    const asarFiles = asar.listPackage(app.getAppPath())
    const distFiles = asarFiles.filter(f => f.startsWith('dist/'))
    
    console.log('Windows: Found dist files in asar:', distFiles.length)
    
    // Extract each dist file
    await fs.mkdir(tempDistDir, { recursive: true })
    
    for (const file of distFiles) {
      const filePath = path.join(tempDir, file)
      const fileDir = path.dirname(filePath)
      
      // Create directory if needed
      await fs.mkdir(fileDir, { recursive: true })
      
      // Extract file
      const content = asar.extractFile(app.getAppPath(), file)
      await fs.writeFile(filePath, content)
    }
    
    console.log('Windows: Successfully extracted dist files')
    tempDistPath = tempDistDir
    return path.join(tempDistDir, 'index.html')
    
  } catch (error) {
    console.error('Windows: Failed to extract dist files:', error)
    return null
  }
}

async function createWindow() {
  logToFile('=== CREATING WINDOW ===')
  logToFile(`Platform: ${process.platform}`)
  logToFile(`isDev: ${isDev}`)
  logToFile(`App path: ${app.getAppPath()}`)
  logToFile(`Resources path: ${process.resourcesPath}`)
  
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    show: false, // Start hidden, show after loading
    center: true, // Center on screen
    resizable: true,
    maximizable: true,
    minimizable: true,
    closable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.cjs'),
      // Standard React/Electron compatibility
      experimentalFeatures: true,
      backgroundThrottling: false
    },
    icon: path.join(__dirname, 'icon.png'),
    titleBarStyle: 'default',
    show: false, // Don't show until ready
    // Platform-specific optimizations
    ...(process.platform === 'darwin' && {
      vibrancy: process.arch === 'x64' ? 'sidebar' : undefined,
      acceptFirstMouse: true,
      backgroundMaterial: 'auto'
    }),
    ...(process.platform === 'win32' && {
      frame: true,
      thickFrame: true,
      autoHideMenuBar: false,
      titleBarStyle: 'default'
    }),
    transparent: false,
    hasShadow: true,
    skipTaskbar: false,
    enableLargerThanScreen: false,
    useContentSize: true
  })

  // Load the app with simplified logic
  let startUrl
  if (isDev) {
    startUrl = 'http://localhost:5173'
    logToFile('Development mode: Loading from dev server')
  } else {
    // Production: Find the React build
    const possiblePaths = [
      // Standard build location
      path.join(app.getAppPath(), 'dist', 'index.html'),
      // Alternative locations
      path.join(__dirname, 'dist', 'index.html'),
      path.join(__dirname, '../dist', 'index.html'),
      path.join(process.resourcesPath, 'app', 'dist', 'index.html')
    ]
    
    logToFile('=== SEARCHING FOR APP FILES ===')
    let targetPath = null
    
    for (const candidatePath of possiblePaths) {
      logToFile(`Checking: ${candidatePath}`)
      try {
        if (fsSync.existsSync(candidatePath)) {
          const stats = fsSync.statSync(candidatePath)
          logToFile(`✅ Found: ${candidatePath} (${stats.size} bytes)`)
          targetPath = candidatePath
          break
        } else {
          logToFile(`❌ Not found: ${candidatePath}`)
        }
      } catch (error) {
        logToFile(`❌ Error checking ${candidatePath}: ${error.message}`)
      }
    }
    
    if (targetPath) {
      startUrl = `file://${targetPath.replace(/\\/g, '/')}`
      logToFile(`✅ Loading React app from: ${startUrl}`)
    } else {
      logToFile('❌ No valid React build found, using fallback')
      startUrl = 'data:text/html;charset=utf-8,<html><body style="background:#1a1a1a;color:white;padding:20px;"><h1>App Not Found</h1><p>Could not locate the React build files.</p></body></html>'
    }
  }
  
  logToFile(`=== LOADING URL ===`)
  logToFile(`URL: ${startUrl}`)
  logToFile(`__dirname: ${__dirname}`)
  logToFile(`isDev: ${isDev}`)
  
  try {
    await mainWindow.loadURL(startUrl)
    logToFile('Successfully loaded URL')
    
    // Show window after successful load
    logToFile('Showing main window...')
    mainWindow.show()
    mainWindow.focus()
    logToFile('Main window shown and focused')
  } catch (error) {
    logToFile(`Failed to load URL: ${error.message}`)
    logToFile(`Error stack: ${error.stack}`)
    
    // Try emergency recovery
    logToFile('Attempting emergency recovery...')
    try {
      const emergencyHTML = 'data:text/html;charset=utf-8,<html><body style="background:#1a1a1a;color:white;font-family:Arial;padding:20px;"><h1>🚨 Emergency Recovery Mode</h1><p>App failed to load main interface.</p><p>Check debug log for details.</p><p>Log location: ' + path.join(os.tmpdir(), 'cephalometric-debug.log') + '</p></body></html>'
      await mainWindow.loadURL(emergencyHTML)
      logToFile('Emergency recovery mode loaded')
      
      // Show window even in emergency mode
      logToFile('Showing emergency recovery window...')
      mainWindow.show()
      mainWindow.focus()
      logToFile('Emergency window shown')
    } catch (recoveryError) {
      logToFile(`Emergency recovery also failed: ${recoveryError.message}`)
    }
  }

  // Add error handling for failed loads
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load:', errorCode, errorDescription, validatedURL)
    
    if (!isDev) {
      console.log('Windows load failed, attempting recovery...')
      
      if (process.platform === 'win32') {
        // Windows-specific recovery - try multiple approaches
        logToFile('=== WINDOWS RECOVERY MODE ===')
        
        const recoveryPaths = [
          // Try the REAL React build first (your actual app)
          path.join(app.getAppPath(), 'dist', 'index.html'),
          // Try resources path for React build
          path.join(process.resourcesPath, 'app.asar', 'dist', 'index.html'),
          // Try __dirname variants for React build
          path.join(__dirname, 'dist', 'index.html'),
          path.join(__dirname, '..', 'dist', 'index.html'),
          // Fallback to vanilla JavaScript if React fails
          path.join(app.getAppPath(), 'cephalometric-analyzer.html'),
          // Last resort: minimal version
          path.join(app.getAppPath(), 'cephalometric-analyzer-minimal.html')
        ]
        
        logToFile(`Windows recovery: trying ${recoveryPaths.length} paths`)
        
        for (const recoveryPath of recoveryPaths) {
          try {
            const recoveryUrl = `file://${recoveryPath.replace(/\\\\/g, '/')}`
            logToFile(`Attempting Windows recovery with: ${recoveryUrl}`)
            
            // Check if path exists before trying to load
            if (require('fs').existsSync(recoveryPath)) {
              logToFile(`Windows recovery path exists: ${recoveryPath}`)
              
              // Additional check for file size (ensure it's not empty)
              const stats = require('fs').statSync(recoveryPath)
              logToFile(`File size: ${stats.size} bytes`)
              
              if (stats.size > 100) { // Ensure file has some content
                mainWindow.loadURL(recoveryUrl)
                logToFile(`Successfully loaded recovery path: ${recoveryPath}`)
                break
              } else {
                logToFile(`File too small, trying next path`)
              }
            } else {
              logToFile(`Windows recovery path does not exist: ${recoveryPath}`)
            }
          } catch (error) {
            logToFile(`Windows recovery attempt failed for ${recoveryPath}: ${error.message}`)
          }
        }
      } else {
        // macOS/Linux recovery
        console.log('Trying alternative path...')
        const altUrl = `file://${path.join(__dirname, '../dist/index.html')}`
        console.log('Alternative URL:', altUrl)
        mainWindow.loadURL(altUrl)
      }
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Page loaded successfully')
  })

  // Add debugging for Windows asset loading issues
  if (process.platform === 'win32') {
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      console.error('Windows asset load failed:', {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame
      })
    })
    
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[Renderer ${level}]:`, message, `at ${sourceId}:${line}`)
    })
    
    mainWindow.webContents.on('dom-ready', () => {
      console.log('Windows: DOM ready')
      // Inject detailed debugging for module loading
      mainWindow.webContents.executeJavaScript(`
        console.log('Windows: DOM loaded, checking elements...');
        console.log('Windows: Root element:', document.getElementById('root'));
        console.log('Windows: Script tags:', document.querySelectorAll('script').length);
        console.log('Windows: Link tags:', document.querySelectorAll('link').length);
        console.log('Windows: Base URL:', document.baseURI);
        console.log('Windows: Current location:', window.location.href);
        
        // Check for JavaScript errors
        window.addEventListener('error', (e) => {
          console.error('Windows: JavaScript error:', e.message, 'at', e.filename + ':' + e.lineno);
        });
        
        window.addEventListener('unhandledrejection', (e) => {
          console.error('Windows: Unhandled promise rejection:', e.reason);
        });
        
        // Check if React is loading
        setTimeout(() => {
          console.log('Windows: React check - window.React:', typeof window.React);
          console.log('Windows: Root innerHTML length:', document.getElementById('root').innerHTML.length);
          console.log('Windows: Any React elements?', document.querySelector('[data-reactroot]') ? 'Yes' : 'No');
        }, 2000);
        
        // List all script src attributes
        const scripts = Array.from(document.querySelectorAll('script[src]'));
        scripts.forEach((script, i) => {
          console.log('Windows: Script ' + i + ':', script.src, 'Type:', script.type || 'text/javascript');
        });
      `)
    })
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    
    // Open DevTools for debugging the React app
    if (isDev || process.platform === 'win32') {
      mainWindow.webContents.openDevTools()
      console.log('DevTools opened for debugging')
    }
  })

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// App event handlers with Intel optimizations
app.whenReady().then(async () => {
  // Cross-platform performance optimizations
  app.commandLine.appendSwitch('--disable-background-timer-throttling')
  app.commandLine.appendSwitch('--disable-renderer-backgrounding')
  app.commandLine.appendSwitch('--disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('--enable-aggressive-domstorage-flushing')
  app.commandLine.appendSwitch('--max_old_space_size', '8192')
  app.commandLine.appendSwitch('--js-flags', '--max-old-space-size=8192 --expose-gc')
  app.commandLine.appendSwitch('--enable-precise-memory-info')
  app.commandLine.appendSwitch('--enable-gpu-rasterization')
  app.commandLine.appendSwitch('--disable-software-rasterizer')
  app.commandLine.appendSwitch('--enable-native-gpu-memory-buffers')
  app.commandLine.appendSwitch('--accelerated-2d-canvas')
  app.commandLine.appendSwitch('--enable-accelerated-2d-canvas')
  app.commandLine.appendSwitch('--memory-pressure-off')
  app.commandLine.appendSwitch('--disable-background-media-suspend')
  app.commandLine.appendSwitch('--disable-low-res-tiling')
  app.commandLine.appendSwitch('--enable-experimental-canvas-features')
  
  // Platform-specific optimizations
  if (process.platform === 'win32') {
    // Windows-specific optimizations
    app.commandLine.appendSwitch('--enable-features', 'D3D11VideoDecoder,SharedArrayBuffer,WebAssemblyCSP')
    app.commandLine.appendSwitch('--enable-d3d11')
    app.commandLine.appendSwitch('--enable-angle-d3d11')
    app.commandLine.appendSwitch('--disable-gpu-vsync')
    app.commandLine.appendSwitch('--force-gpu-mem-available-mb', '4096')
    app.commandLine.appendSwitch('--enable-zero-copy')
    app.commandLine.appendSwitch('--enable-oop-rasterization')
    app.commandLine.appendSwitch('--disable-frame-rate-limit')
    app.setAppUserModelId('com.cephalometric.analyzer')
    
    // Set high priority for Windows
    try {
      process.setpriority(process.pid, -10)
    } catch (error) {
      console.log('Could not set process priority:', error.message)
    }
  } else if (process.platform === 'darwin') {
    // macOS-specific optimizations
    app.commandLine.appendSwitch('--enable-features', 'VaapiVideoDecoder,SharedArrayBuffer,WebAssemblyCSP')
    app.commandLine.appendSwitch('--enable-zero-copy')
    app.commandLine.appendSwitch('--enable-oop-rasterization')
    app.commandLine.appendSwitch('--enable-raw-draw')
    app.commandLine.appendSwitch('--disable-frame-rate-limit')
    app.commandLine.appendSwitch('--disable-gpu-vsync')
    app.commandLine.appendSwitch('--enable-quic')
    app.commandLine.appendSwitch('--enable-tcp-fast-open')
    app.commandLine.appendSwitch('--max-gum-fps', '60')
    app.commandLine.appendSwitch('--force-gpu-mem-available-mb', '2048')
    app.setAppUserModelId('com.cephalometric.analyzer')
    
    // Set high priority for macOS
    try {
      process.setpriority(process.pid, -10)
    } catch (error) {
      console.log('Could not set process priority:', error.message)
    }
  }
  
  await createWindow()
  createMenu()

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // Clean up Windows resources
  if (process.platform === 'win32') {
    // Stop local server
    if (localServer) {
      localServer.close(() => {
        console.log('Windows: Local server stopped')
      })
      localServer = null
      serverPort = null
    }
    
    // Clean up temp files
    if (tempDistPath) {
      try {
        fsSync.rmSync(path.dirname(tempDistPath), { recursive: true, force: true })
        console.log('Windows: Cleaned up temporary files')
      } catch (error) {
        console.log('Windows: Error cleaning temp files:', error.message)
      }
    }
  }
  
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Create application menu
function createMenu() {
  const template = [
    {
      label: 'Cephalometric Analyzer',
      submenu: [
        {
          label: 'About Cephalometric Analyzer',
          role: 'about'
        },
        { type: 'separator' },
        {
          label: 'Services',
          role: 'services',
          submenu: []
        },
        { type: 'separator' },
        {
          label: 'Hide Cephalometric Analyzer',
          accelerator: 'Command+H',
          role: 'hide'
        },
        {
          label: 'Hide Others',
          accelerator: 'Command+Alt+H',
          role: 'hideothers'
        },
        {
          label: 'Show All',
          role: 'unhide'
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'Command+Q',
          click: () => {
            app.quit()
          }
        }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Image...',
          accelerator: 'Command+O',
          click: () => {
            openImageDialog()
          }
        },
        {
          label: 'Load Analysis...',
          accelerator: 'Command+L',
          click: () => {
            openCephDialog()
          }
        },
        { type: 'separator' },
        {
          label: 'Save Analysis...',
          accelerator: 'Command+S',
          click: () => {
            // This will trigger save functionality in the renderer
            mainWindow.webContents.send('menu-save')
          }
        },
        {
          label: 'Export PDF...',
          accelerator: 'Command+E',
          click: () => {
            // This will trigger export functionality in the renderer
            mainWindow.webContents.send('menu-export-pdf')
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'Command+Z',
          role: 'undo'
        },
        {
          label: 'Redo',
          accelerator: 'Shift+Command+Z',
          role: 'redo'
        },
        { type: 'separator' },
        {
          label: 'Cut',
          accelerator: 'Command+X',
          role: 'cut'
        },
        {
          label: 'Copy',
          accelerator: 'Command+C',
          role: 'copy'
        },
        {
          label: 'Paste',
          accelerator: 'Command+V',
          role: 'paste'
        },
        {
          label: 'Select All',
          accelerator: 'Command+A',
          role: 'selectall'
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'Command+R',
          click: () => {
            mainWindow.reload()
          }
        },
        {
          label: 'Force Reload',
          accelerator: 'Command+Shift+R',
          click: () => {
            mainWindow.webContents.reloadIgnoringCache()
          }
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'F12',
          click: () => {
            mainWindow.webContents.toggleDevTools()
          }
        },
        { type: 'separator' },
        {
          label: 'Actual Size',
          accelerator: 'Command+0',
          role: 'resetzoom'
        },
        {
          label: 'Zoom In',
          accelerator: 'Command+Plus',
          role: 'zoomin'
        },
        {
          label: 'Zoom Out',
          accelerator: 'Command+-',
          role: 'zoomout'
        },
        { type: 'separator' },
        {
          label: 'Toggle Fullscreen',
          accelerator: 'Control+Command+F',
          role: 'togglefullscreen'
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Minimize',
          accelerator: 'Command+M',
          role: 'minimize'
        },
        {
          label: 'Close',
          accelerator: 'Command+W',
          role: 'close'
        },
        { type: 'separator' },
        {
          label: 'Bring All to Front',
          role: 'front'
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About',
              message: 'Cephalometric Analyzer',
              detail: 'Professional orthodontic and dental X-ray analysis application\n\nVersion: 1.0.0\nBuilt with React, TypeScript, and Electron'
            })
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// File dialog handlers
async function openImageDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Cephalometric Image',
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'tif', 'tiff'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })

  if (!result.canceled && result.filePaths.length > 0) {
    // Send the file path to the renderer process
    mainWindow.webContents.send('file-opened', result.filePaths[0])
  }
}

async function openCephDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Load Cephalometric Analysis',
    filters: [
      { name: 'Ceph Files', extensions: ['ceph'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  })

  if (!result.canceled && result.filePaths.length > 0) {
    // Send the file path to the renderer process
    mainWindow.webContents.send('ceph-file-opened', result.filePaths[0])
  }
}

// IPC handlers for save dialogs
ipcMain.handle('show-save-dialog', async (event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options)
  return result
})

ipcMain.handle('show-open-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options)
  return result
})

ipcMain.handle('write-file', async (event, filePath, data) => {
  try {
    await fs.writeFile(filePath, data, 'utf8')
    return { success: true }
  } catch (error) {
    console.error('Error writing file:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('write-binary-file', async (event, filePath, base64Data) => {
  try {
    const buffer = Buffer.from(base64Data, 'base64')
    await fs.writeFile(filePath, buffer)
    return { success: true }
  } catch (error) {
    console.error('Error writing binary file:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('open-file', async (event, filePath) => {
  try {
    await shell.openPath(filePath)
    return { success: true }
  } catch (error) {
    console.error('Error opening file:', error)
    return { success: false, error: error.message }
  }
})

// Handle app certificate verification
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (isDev) {
    // In development, ignore certificate errors
    event.preventDefault()
    callback(true)
  } else {
    // In production, use default behavior
    callback(false)
  }
})