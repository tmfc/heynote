import CONFIG from "../config"
import { Notification } from 'electron';

var PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find')); // 引入 find 插件
const db = new PouchDB('notes');
// check note_id index, if not exist, create index
db.getIndexes().then(result => {
    const indexExists = result.indexes && result.indexes.some(index => index.def.fields.some(field => Object.keys(field)[0] === 'note_id'));
    if (!indexExists) {
        return db.createIndex({
            index: {
                fields: ['note_id']
            }
        });
    }
});
var syncHandler = null;

export class Buffer {
    constructor({ onChange }) {
        this.onChange = onChange;
        this._lastSavedContent = null;
        this.newBlocksFromRemote = [];
        
        this.currentNoteIndex = CONFIG.get("noteIndex");
        this.enableSync = CONFIG.get("settings.enableSync"); // 获取同步功能设置
        if (this.enableSync) {
            this.startSync();
        }
        
        this.delim = '\n∞∞∞';
    }

    async startSync() {
        
        this.enableSync = true;
        console.log("startSync", syncHandler);
        if (syncHandler) {
            syncHandler.cancel();
        }
        await this.sync();
        console.log("startSync end", syncHandler);
    }

    stopSync() {
        this.enableSync = false;
        console.log("stopSync", syncHandler);
        if (syncHandler) {
            syncHandler.cancel();
            syncHandler = null;
        }
        console.log("stopSync end", syncHandler);
    }

    async sync() {
        if (!this.enableSync) {
            console.log("Sync is disabled.");
            return; // 如果未启用同步，则返回
        }

        // 同步本地数据库与远程数据库
        const remoteDbUrl = CONFIG.get("settings.remoteDbUrl");
        const remoteDbUsername = CONFIG.get("settings.remoteDbUsername");
        const remoteDbPassword = CONFIG.get("settings.remoteDbPassword");
        const remoteDb = new PouchDB(remoteDbUrl, {
            auth: {
                username: remoteDbUsername,
                password: remoteDbPassword
            }
        });

        syncHandler = db.sync(remoteDb, {
            live: true,
            retry: true
        }).on('change', async (info) => {
            if(info.direction == 'pull')
            {
                // 检查从远程服务器获取到的新 block 中有没有 note_id 是当前文档的
                const newBlocks = info.change.docs;
                const currentNoteId = this.currentNoteIndex;
                const currentNoteUpdated = newBlocks.some(block => block.note_id === currentNoteId);
                if (currentNoteUpdated) {
                    console.log("当前文档被更像了");
                    // 在界面上弹出一个提示，提示用户有新的内容
                    const notification = new Notification({
                        title: '从远程服务器获取到新内容',
                        body: '点击刷新笔记',
                        icon: 'path/to/icon.png', // 可选
                    });
                
                    notification.on('click', () => {
                        // 刷新笔记
                        this.load().then(result => {
                            this.onChange(result);
                            notification.close();
                        });
                    });
                
                    notification.on('close', () => {
                        console.log('通知被关闭！');
                    });
                
                    notification.show();
                }

                // 获取到所有block 的 _id，保存到 this.newBlocksFromRemote
                this.newBlocksFromRemote = newBlocks.map(block => block._id);
            }
            
        }).on('paused', (info) => {
            console.log("Sync paused:", info);
        }).on('active', (info) => {
            console.log("Sync resumed:", info);
        }).on('error', (err) => {
            console.error("Sync error:", err);
        });
        
        console.log("sync end", syncHandler);
        return syncHandler; // 返回同步处理程序
    }

    async load() {
        const notes = await this.getBlocks();
        // 组合返回内容，格式为 this.delim + note.type + "||" + note._id + note.content
        let result = notes.map(note => {
            const type = note.type || 'text-a';
            return this.delim + type + ";;;" + note._id + '\n' + note.content;
        }).join('');

        return result;
    }

    async save(content) {
        const noteId = this.currentNoteIndex;

        const existingBlocks = await this.getBlocks(noteId); // 获取当前所有block
        const notes = content.split(this.delim); // 按分隔符切分内容

        const responses = [];
        const docIdsInContent = new Set(); // 用于存储当前内容中的 block._id
        // 将 this.newBlocksFromRemote 中的 _id 添加到 docIdsInContent，防止从服务器pull下来的block被删除
        this.newBlocksFromRemote.forEach(blockId => {
            docIdsInContent.add(blockId);
        });

        for (const noteContent of notes) {
            if (noteContent == "")
                continue;
            const [typeWithId, ...rest] = noteContent.trim().split('\n');
            const blockId = typeWithId.split(';;;')[1]; // 假设 note_id 在 typeWithId 中
            const blockType = typeWithId.split(';;;')[0].replace(/∞/g, ''); // 获取类型并替换 ∞ 为空白
            const blockData = rest.join('\n').trim(); // 其他内容

            docIdsInContent.add(blockId); // 将 note_id 添加到集合中

            if (blockId) {
                // 更新现有文档
                const existingBlock = existingBlocks.find(block => block._id === blockId); // 从 existingBlocks 获取
                if (existingBlock) {
                    // 检查内容是否有改变
                    if (existingBlock.content !== blockData || existingBlock.type !== blockType) {
                        existingBlock.content = blockData; // 更新内容
                        existingBlock.type = blockType; // 更新类型
                        const response = await db.put(existingBlock);
                        responses.push(response);
                    }
                }
            } else {
                // 新建文档
                const newBlockId = generateUniqueId(); // 生成 _id
                docIdsInContent.add(newBlockId);
                const newBlock = { _id: newBlockId, content: blockData, note_id: noteId, type: blockType }; // 增加 node_id 和 type 字段
                const response = await db.put(newBlock);
                responses.push(response);
            }
        }

        // 处理删除操作
        for (const existingNote of existingBlocks) {
            if (!docIdsInContent.has(existingNote._id)) {
                await db.remove(existingNote); // 删除不存在于 notes 中的文档
            }
        }

        this._lastSavedContent = content;
        this.newBlocksFromRemote = []; // 清空 this.newBlocksFromRemote
        return responses; // 返回所有保存的响应
    }

    async getBlocks(noteId = this.currentNoteIndex) {
        const result = await db.find({
            selector: { note_id: noteId }, // 根据 note_id 查询文档
            include_docs: true // 包含文档内容
        });
        return result.docs; // 返回符合条件的文档
    }

    async toggle(oldIndex, newIndex) {
        this.currentNoteIndex = newIndex; // 切换当前笔记索引
        const noteExists = await this.exists();
        if(noteExists)
        {
            const notes = await this.getBlocks();
            let result = notes.map(note => {
                const type = note.type || 'text';

                return this.delim + type + ";;;" + note._id + '\n' + note.content;
            }).join('');

            this.onChange(result);
        }
        else 
        {
            const defaultNote = `
∞∞∞markdown;;;
Welcome to Heynote! 👋
this is a new note, No.${this.currentNoteIndex}
∞∞∞text-a;;;
`
            this.onChange(defaultNote);
        }
    }

    async exists() {
        const result = await db.find({
            selector: { note_id: this.currentNoteIndex },
            limit: 1 // 只需要检查是否存在，限制返回结果为1
        });
        return result.docs.length > 0; // 返回存在`与否
    }

    async testConnection(url, username, password) {
        try {
            const remoteDb = new PouchDB(url, {
                auth: {
                    username: username,
                    password: password
                }
            });
            let info = await remoteDb.info();
            // let index = await remoteDb.getIndexes()
            return true; // 连接成功，返回 true
        } catch (error) {
            console.error("连接失败:", error);
            return false; // 连接失败，返回 false
        }
    }
    
    close() {
        // PouchDB 不需要关闭
    }

}

function generateUniqueId() {
    const timestamp = Date.now(); // 当前时间戳
    const randomNum = Math.floor(Math.random() * 1000); // 生成随机数
    const uniqueId = `${timestamp}${randomNum}`; // 组合时间戳和随机数
    return uniqueId;
}