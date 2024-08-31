import fs from "fs"
import os from "node:os"
import { join, dirname, basename } from "path"
import { app, ipcMain, dialog } from "electron"
import * as jetpack from "fs-jetpack";

import CONFIG from "../config"
import { isDev } from "../detect-platform"
import { win } from "./index"
import { eraseInitialContent, initialContent, initialDevContent } from '../initial-content'

const untildify = (pathWithTilde) => {
    const homeDirectory = os.homedir();
    return homeDirectory
      ? pathWithTilde.replace(/^~(?=$|\/|\\)/, homeDirectory)
      : pathWithTilde;
}

export function constructBufferFilePath(directoryPath) {
    return join(untildify(directoryPath), isDev ? "buffer-dev.txt" : "buffer.txt")
}

export function getBufferFilePath() {
    let defaultPath = app.getPath("userData")
    let configPath = CONFIG.get("settings.bufferPath")
    let bufferPath = configPath.length ? configPath : defaultPath
    let bufferFilePath = constructBufferFilePath(bufferPath)
    try {
        // use realpathSync to resolve a potential symlink
        return fs.realpathSync(bufferFilePath)
    } catch (err) {
        // realpathSync will fail if the file does not exist, but that doesn't matter since the file will be created
        if (err.code !== "ENOENT") {
            throw err
        }
        return bufferFilePath
    }
}


export class Buffer {
    constructor({filePath, onChange}) {
        this.filePath = filePath
        this.onChange = onChange
        this.watcher = null
        this.setupWatcher()
        this._lastSavedContent = null
    }

    async load() {
        const content = await jetpack.read(this.filePath, 'utf8')
        this.setupWatcher()
        return content
    }

    async save(content) {
        this._lastSavedContent = content
        const saveResult = await jetpack.write(this.filePath, content, {
            atomic: true,
            mode: '600',
        })
        return saveResult
    }

    exists() {
        return jetpack.exists(this.filePath) === "file"
    }

    setupWatcher() {
        if (!this.watcher && this.exists()) {
            this.watcher = fs.watch(
                dirname(this.filePath), 
                {
                    persistent: true,
                    recursive: false,
                    encoding: "utf8",
                },
                async (eventType, filename) => {
                    if (filename !== basename(this.filePath)) {
                        return
                    }
                    
                    // read the file content and compare it to the last saved content
                    // (if the content is the same, then we can ignore the event)
                    const content = await jetpack.read(this.filePath, 'utf8')

                    if (this._lastSavedContent !== content) {
                        // file has changed on disk, trigger onChange
                        this.onChange(content)
                    }
                }
            )
        }
    }

    close() {
        if (this.watcher) {
            this.watcher.close()
            this.watcher = null
        }
    }

    async toggle(oldIndex, newIndex) {
        
        // 判断文件是否存在
        const newFilePath = this.filePath.replace('.txt', `${newIndex}.txt`);
        if (!jetpack.exists(newFilePath)) {
            let defaultContent = '\n∞∞∞text-a\n';
            // 如果文件不存在，则将文件内容置为默认内容
            await jetpack.write(newFilePath, defaultContent, {
                atomic: true,
                mode: '600',
            });
        }
        const oldFilePath = this.filePath.replace('.txt', `${oldIndex}.txt`); 
        await jetpack.copy(this.filePath, oldFilePath, { overwrite: true }); 
        const content = await jetpack.read(newFilePath, 'utf8');

        this.onChange(content);
    }
}


// Buffer
let buffer
export function loadBuffer() {
    if (buffer) {
        buffer.close()
    }
    buffer = new Buffer({
        filePath: getBufferFilePath(),
        onChange: (content) => {
            win?.webContents.send("buffer-content:change", content)
        },
    })
    return buffer
}

export async function toggleBuffer(oldIndex, newIndex) {
    if(buffer) {
        await buffer.toggle(oldIndex, newIndex)
    }
}

ipcMain.handle('buffer-content:load', async () => {
    if (buffer.exists() && !(eraseInitialContent && isDev)) {
        return await buffer.load()
    } else {
        return isDev ? initialDevContent : initialContent
    }
});

async function save(content) {
    return await buffer.save(content)
}

ipcMain.handle('buffer-content:save', async (event, content) => {
    return await save(content)
});

export let contentSaved = false
ipcMain.handle('buffer-content:saveAndQuit', async (event, content) => {
    await save(content)
    contentSaved = true
    app.quit()
})

ipcMain.handle("buffer-content:selectLocation", async () => {
    let result = await dialog.showOpenDialog({
        title: "Select directory to store buffer",
        properties: [
            "openDirectory",
            "createDirectory",
            "noResolveAliases",
        ],
    });
    if (result.canceled) {
        return;
    }
    const newDirectoryPath = result.filePaths[0];
    const currentBufferDirectoryPath = dirname(getBufferFilePath());

    // 获取当前缓冲区目录下的所有文件
    const files = fs.readdirSync(currentBufferDirectoryPath);

    // 记录用户的选择
    let overwriteFiles = [];
    let mergeFiles = [];

    for (const file of files) {
        const currentFilePath = join(currentBufferDirectoryPath, file);
        const newFilePath = join(newDirectoryPath, file);

        if (fs.existsSync(newFilePath)) {
            overwriteFiles.push(file); // 记录需要覆盖的文件
        } else {
            // 如果没有同名文件，直接复制
            await jetpack.copy(currentFilePath, newFilePath, { overwrite: true });
        }
    }

    // 询问用户如何处理需要覆盖的文件
    if (overwriteFiles.length > 0) {
        const response = dialog.showMessageBoxSync({
            type: "question",
            message: `The following files already exist in the selected directory: ${overwriteFiles.join(', ')}. Do you want to overwrite them or merge their content?`,
            buttons: ["Overwrite", "Merge", "Cancel"],
        });

        for (const file of overwriteFiles) {
            const currentFilePath = join(currentBufferDirectoryPath, file);
            const newFilePath = join(newDirectoryPath, file);

            if (response === 0) {
                // Overwrite the existing file
                await jetpack.copy(currentFilePath, newFilePath, { overwrite: true });
            } else if (response === 1) {
                // Merge content
                const existingContent = await jetpack.read(newFilePath, 'utf8');
                const currentContent = await jetpack.read(currentFilePath, 'utf8');
                const mergedContent = existingContent + '\n' + currentContent; // Example merge logic
                await jetpack.write(newFilePath, mergedContent, { atomic: true });
            }
        }
    }

    return newDirectoryPath;
});
