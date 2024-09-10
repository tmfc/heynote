import CONFIG from "../config"

var PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find')); // 引入 find 插件
const db = new PouchDB('notes');
// check note_id index, if not exist, create index
db.getIndexes().then(result => {
    const indexExists = result.indexes && result.indexes.some(index => index.def.fields.some(field => Object.keys(field)[0] === 'note_id'));
    console.log("indexExists:" + indexExists);
    if (!indexExists) {
        return db.createIndex({
            index: {
                fields: ['note_id']
            }
        });
    }
});

export class Buffer {
    constructor({ onChange }) {
        this.onChange = onChange;
        this._lastSavedContent = null;
        this.newBlocksFromRemote = [];
        
        this.currentNoteIndex = CONFIG.get("noteIndex");
        this.enableSync = CONFIG.get("settings.enableSync"); // 获取同步功能设置
        console.log("current note index:" + this.currentNoteIndex);
        this.sync().then(handler => {console.log("sync handler:" + handler); this.syncHandler = handler;});
        
        this.delim = '\n∞∞∞';
    }

    async load() {
        const notes = await this.getBlocks();
        // 组合返回内容，格式为 this.delim + note.type + "||" + note._id + note.content
        let result = notes.map(note => {
            const type = note.type || 'text-a';
            return this.delim + type + ";;;" + note._id + '\n' + note.content;
        }).join('');
        // 打印 notes数量
        // console.log("couchBuffer loads:" + result);

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
                console.log("newBlock _id: " + newBlock._id + ", note_id: " + newBlock.note_id + ", type: " + newBlock.type);
                const response = await db.put(newBlock);
                responses.push(response);
            }
        }

        // 处理删除操作
        for (const existingNote of existingBlocks) {
            if (!docIdsInContent.has(existingNote._id)) {
                console.log("delete block:" + existingNote._id);
                await db.remove(existingNote); // 删除不存在于 notes 中的文档
            }
        }

        this._lastSavedContent = content;
        this.newBlocksFromRemote = []; // 清空 this.newBlocksFromRemote
        return responses; // 返回所有保存的响应
    }

    async getBlocks(noteId = this.currentNoteIndex) {
        console.log("get blocks for note:" + noteId);
        const result = await db.find({
            selector: { note_id: noteId }, // 根据 note_id 查询文档
            include_docs: true // 包含文档内容
        });
        // 输出获取到的 block 的 note_id 和 content
        result.docs.forEach(block => {
            console.log("block _id:", block._id);
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
            console.log("show default note:" + this.currentNoteIndex);
            this.onChange(defaultNote);
        }
    }

    async exists() {
        const result = await db.find({
            selector: { note_id: this.currentNoteIndex },
            limit: 1 // 只需要检查是否存在，限制返回结果为1
        });
        console.log("couchBuffer exists:" + result.docs.length > 0);
        return result.docs.length > 0; // 返回存在`与否
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

        const syncHandler = db.sync(remoteDb, {
            live: true,
            retry: true
        }).on('change', async (info) => {
            console.log("Sync change:", info);
            if(info.direction == 'pull')
            {
                // 检查从远程服务器获取到的新 block 中有没有 note_id 是当前文档的
                const newBlocks = info.change.docs;
                const currentNoteId = this.currentNoteIndex;
                const hasCurrentNoteId = newBlocks.some(block => block.note_id === currentNoteId);
                if (hasCurrentNoteId) {
                    console.log("当前文档的 note_id 存在于新获取的 block 中");
                }
                // 输出获取到的 block 的 note_id 和 content
                newBlocks.forEach(block => {
                    console.log("block _id:", block._id, "block note_id:", block.note_id, "content:", block.content, "type:", block.type);
                });
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
        
        return syncHandler; // 返回同步处理程序
    }

    async testConnection(url, username, password) {
        console.log(password)
        try {
            const remoteDb = new PouchDB(url, {
                auth: {
                    username: username,
                    password: password
                }
            });
            let info = await remoteDb.info();
            // let index = await remoteDb.getIndexes()
            console.log(info)
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