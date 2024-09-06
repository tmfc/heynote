import { expect, test } from "@playwright/test"
import { EditorState } from "@codemirror/state"

import { heynoteLang } from "../src/editor/lang-heynote/heynote.js"
import { getBlocksFromSyntaxTree, getBlocksFromString } from "../src/editor/block/block.js"

test("parse blocks from both syntax tree and string contents", async ({page}) => {
    let contents = `
∞∞∞text;;;123
Text Block A
∞∞∞text-a;;;124
Text Block B
∞∞∞json-a;;;125
{
"key": "value"
}
∞∞∞python;;;126
print("Hello, World!")
`
contents = `
∞∞∞html;;;1725625587741429
<html>
    <head>
        <title>Test</title>
    </head>
    <body>
        <h1>Test</h1>
        <script>
            console.log("hej")
        </script>
    </body>
</html>
∞∞∞sql;;;1725625587741620
SELECT * FROM table WHERE id = 1;
∞∞∞text;;;1725625587742993
Shopping list:

- Milk
- Eggs
- Bread
- Cheese
`
    const state = EditorState.create({
        doc: contents,
        extensions: heynoteLang(),
    })
    const treeBlocks = getBlocksFromSyntaxTree(state)
    const stringBlocks = getBlocksFromString(state)

    console.log("treeBlock:" + treeBlocks.length);
    console.log("stringBlock:" + stringBlocks.length);
    console.log(stringBlocks[0]);
    console.log(treeBlocks[0]);
    expect(treeBlocks).toEqual(stringBlocks)
})
