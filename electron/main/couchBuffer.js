var PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-find')); // 引入 find 插件
const db = new PouchDB('notes');

export class Buffer {
    constructor({ onChange }) {
        this.onChange = onChange;
        this._lastSavedContent = null;
        this.currentNoteIndex = 1; // 新增属性，用于保存当前笔记索引
        this.delim = '\n∞∞∞';
    }

    async load() {
        const notes = await this.getNotes();
        // 组合返回内容，格式为 this.delim + note.type + "||" + note._id + note.content
        let result = notes.map(note => {
            const type = note.type || 'text';
            console.log("note type:" + note.type);
            console.log("note content:" + note.content);
            return this.delim + type + ";;;" + note._id + '\n' + note.content;
        }).join('');
        // 打印 notes数量
        console.log("couchBuffer loads:" + result);

        return result;
    }

    async save(content) {
        console.log("couchBuffer save:" + content);
        const notes = content.split(this.delim); // 按分隔符切分内容
        console.log("note count:" + notes.length);
        console.log("currentNoteIndex:" + this.currentNoteIndex);
        const responses = [];
        const docIdsInContent = new Set(); // 用于存储当前内容中的 note_id

        for (const noteContent of notes) {
            if(noteContent == "")
                continue;
            const [typeWithId, ...rest] = noteContent.trim().split('\n');
            const docId = typeWithId.split(';;;')[1]; // 假设 note_id 在 typeWithId 中
            const noteType = typeWithId.split(';;;')[0].replace(/∞/g, ''); // 获取类型并替换 ∞ 为空白
            const noteData = rest.join('\n').trim(); // 其他内容

            docIdsInContent.add(docId); // 将 note_id 添加到集合中

            if (docId) {
                // 更新现有文档
                const existingNote = await db.get(docId).catch(() => null);
                if (existingNote) {
                    existingNote.content = noteData; // 更新内容
                    existingNote.type = noteType; // 更新类型
                    const response = await db.put(existingNote);
                    responses.push(response);
                }
            } else {
                // 新建文档
                const newNoteId = generateSnowflakeId(); // 使用雪花算法生成 _id
                const newNote = { _id: newNoteId, content: noteData, note_id: this.currentNoteIndex, type: noteType }; // 增加 node_id 和 type 字段
                console.log(newNote);
                const response = await db.put(newNote);
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
        const result = await db.allDocs({ include_docs: true }); // 使用 allDocs 查询所有文档
        return result.rows.map(row => row.doc); // 返回所有文档
    }

    async toggle(oldIndex, newIndex) {
        this.currentNoteIndex = newIndex; // 切换当前笔记索引
        const notes = await this.getNotes();
        const newNote = notes[newIndex] || { content: '\n∞∞∞text-a\n' };
        this.onChange(newNote.content);
    }

    async exists() {
        console.log(this.currentNoteIndex);
        const result = await db.find({
            selector: { note_id: this.currentNoteIndex },
            limit: 1 // 只需要检查是否存在，限制返回结果为1
        });
        console.log("couchBuffer exists:" + result.docs.length);
        return result.docs.length > 0; // 返回存在与否
    }

    close() {
        // PouchDB 不需要关闭
    }
}

function generateSnowflakeId() {
    const timestamp = Date.now(); // 当前时间戳
    const randomNum = Math.floor(Math.random() * 1000); // 生成随机数
    const snowflakeId = `${timestamp}${randomNum}`; // 组合时间戳和随机数
    return snowflakeId;
}