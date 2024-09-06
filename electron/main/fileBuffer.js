import fs from "fs"
import os from "node:os"
import { join, dirname, basename } from "path"
import { app, ipcMain, dialog } from "electron"
import * as jetpack from "fs-jetpack";

import CONFIG from "../config"



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
    constructor({onChange}) {
        this.filePath = getBufferFilePath()
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

    async exists() {
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

