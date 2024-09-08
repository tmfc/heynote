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
        
        this.currentNoteIndex = CONFIG.get("fileIndex");
        console.log("current note index:" + this.currentNoteIndex);
        
        this.delim = '\n∞∞∞';
    }

    async load() {
        const notes = await this.getNotes();
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
        const note_id = this.currentNoteIndex;
        // console.log("couchBuffer save:" + content);
        const notes = content.split(this.delim); // 按分隔符切分内容
        // console.log("note count:" + notes.length);
        // console.log("currentNoteIndex:" + this.currentNoteIndex);
        const responses = [];
        const docIdsInContent = new Set(); // 用于存储当前内容中的 block._id

        for (const noteContent of notes) {
            if(noteContent == "")
                continue;
            const [typeWithId, ...rest] = noteContent.trim().split('\n');
            const blockId = typeWithId.split(';;;')[1]; // 假设 note_id 在 typeWithId 中
            const blockType = typeWithId.split(';;;')[0].replace(/∞/g, ''); // 获取类型并替换 ∞ 为空白
            const blockData = rest.join('\n').trim(); // 其他内容

            docIdsInContent.add(blockId); // 将 note_id 添加到集合中

            if (blockId) {
                // 更新现有文档
                const existingBlock = await db.get(blockId).catch(() => null);
                if (existingBlock) {
                    existingBlock.content = blockData; // 更新内容
                    existingBlock.type = blockType; // 更新类型
                    const response = await db.put(existingBlock);
                    responses.push(response);
                }
            } else {
                // 新建文档
                const newBlockId = generateUniqueId(); // 生成 _id
                const newBlock = { _id: newBlockId, content: blockData, note_id: note_id, type: blockType }; // 增加 node_id 和 type 字段
                console.log("newBlock _id: " + newBlock._id + ", note_id: " + newBlock.note_id + ", type: " + newBlock.type);
                const response = await db.put(newBlock);
                responses.push(response);
            }
        }

        // // 处理删除操作
        // const existingNotes = await this.getNotes(); // 获取当前所有文档
        // for (const existingNote of existingNotes) {
        //     if (!docIdsInContent.has(existingNote._id)) {
        //         await db.remove(existingNote); // 删除不存在于 notes 中的文档
        //     }
        // }

        this._lastSavedContent = content;
        return responses; // 返回所有保存的响应
    }

    async getNotes() {
        console.log("getNotes:" + this.currentNoteIndex);
        const result = await db.find({
            selector: { note_id: this.currentNoteIndex }, // 根据 note_id 查询文档
            include_docs: true // 包含文档内容
        });
        console.log("文档数量: " + result.docs.length);
        return result.docs; // 返回符合条件的文档
    }

    async toggle(oldIndex, newIndex) {
        this.currentNoteIndex = newIndex; // 切换当前笔记索引
        const noteExists = await this.exists();
        if(noteExists)
        {
            const notes = await this.getNotes();
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