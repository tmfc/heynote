import { Buffer} from './couchBuffer'; // 引入 Buffer 类
import { win } from "./index"
import { eraseInitialContent, initialContent, initialDevContent } from '../initial-content'
import { app, ipcMain } from "electron"
import { isDev } from "../detect-platform"

let buffer;
export function loadBuffer() {
    if (buffer) {
        buffer.close();
    }
    buffer = new Buffer({
        onChange: (content) => {
            win?.webContents.send("buffer-content:change", content);
        },
    });
    return buffer;
}

export async function toggleBuffer(oldIndex, newIndex) {
    if (buffer) {
        await buffer.toggle(oldIndex, newIndex);
    }
}

ipcMain.handle('buffer-content:load', async () => {
    let buffer_exists = await buffer.exists();
    if (buffer_exists && !(eraseInitialContent && isDev)) {
        return await buffer.load();
    } else {

        return isDev ? initialDevContent : initialContent;
    }
});

async function save(content) {
    return await buffer.save(content);
}

ipcMain.handle('buffer-content:save', async (event, content) => {
    return await save(content);
});

export let contentSaved = false;
ipcMain.handle('buffer-content:saveAndQuit', async (event, content) => {
    await save(content);
    contentSaved = true;
    app.quit();
});

ipcMain.handle("buffer-content:selectLocation", async () => {
    return await buffer.selectLocation(); // 使用 Buffer 类中的 selectLocation 方法
});

ipcMain.handle("buffer-content:testConnection", async (event, url, username, password) => {
    return await buffer.testConnection(url, username, password); // 使用 Buffer 类中的 testConnection 方法
});

ipcMain.handle("toggle-sync", (event, enable) => {
    console.log("ipc Main toggle-sync", enable);
    if (enable) {
        buffer.startSync();
    } else {
        buffer.stopSync();
    }
});