const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Tasks
  createTask:   (task)       => ipcRenderer.invoke('task:create', task),
  updateTask:   (id, fields) => ipcRenderer.invoke('task:update', id, fields),
  completeTask: (id)         => ipcRenderer.invoke('task:complete', id),
  deleteTask:   (id)         => ipcRenderer.invoke('task:delete', id),
  listTasks:    (filters)    => ipcRenderer.invoke('task:list', filters),

  // Stats
  statsByDay:      () => ipcRenderer.invoke('stats:byDayOfWeek'),
  statsByMonth:    () => ipcRenderer.invoke('stats:byMonth'),
  statsByWeek:     () => ipcRenderer.invoke('stats:byWeek'),
  statsByCategory: () => ipcRenderer.invoke('stats:byCategory'),
  statsSummary:    () => ipcRenderer.invoke('stats:summary'),

  // DB
  exportDb:     () => ipcRenderer.invoke('db:export'),
  closeDb:      () => ipcRenderer.invoke('db:close'),
  getDbPath:    () => ipcRenderer.invoke('db:getPath'),
  chooseDbPath: () => ipcRenderer.invoke('db:choosePath'),
});