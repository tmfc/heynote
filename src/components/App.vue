<script>
    import StatusBar from './StatusBar.vue'
    import Editor from './Editor.vue'
    import LanguageSelector from './LanguageSelector.vue'
    import Settings from './settings/Settings.vue'

    export default {
        components: {
            Editor,
            StatusBar,
            LanguageSelector,
            Settings,
        },

        data() {
            return {
                noteIndex: 1,
                line: 1,
                column: 1,
                selectionSize: 0,
                language: "plaintext",
                languageAuto: true,
                theme: window.heynote.themeMode.initial,
                initialTheme: window.heynote.themeMode.initial,
                themeSetting: 'system',
                development: window.location.href.indexOf("dev=1") !== -1,
                showLanguageSelector: false,
                showSettings: false,
                settings: window.heynote.settings,
            }
        },

        mounted() {           
            this.noteIndex = window.heynote.getNoteIndex().then((noteIndex) => {
                this.noteIndex = noteIndex;
            })

            window.heynote.themeMode.get().then((mode) => {
                this.theme = mode.computed
                this.themeSetting = mode.theme
            })
            const onThemeChange = (theme) => {
                this.theme = theme
                if (theme === "system") {
                    document.documentElement.setAttribute("theme", window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
                } else {
                    document.documentElement.setAttribute("theme", theme)
                }
            }
            onThemeChange(window.heynote.themeMode.initial)
            window.heynote.onToggleNote((newNoteIndex) => {
                console.log("app on toggle note callback:", newNoteIndex)
                this.noteIndex = newNoteIndex
            })
            window.heynote.themeMode.onChange(onThemeChange)
            window.heynote.onSettingsChange((settings) => {
                this.settings = settings
            })
            window.heynote.onOpenSettings(() => {
                this.showSettings = true
            })
        },

        beforeUnmount() {
            window.heynote.themeMode.removeListener()
        },

        methods: {
            openSettings() {
                this.showSettings = true
            },
            closeSettings() {
                this.showSettings = false
                this.$refs.editor.focus()
            },

            toggleNote(newNoteIndex) {
                if (newNoteIndex === this.noteIndex) {
                    return
                }
                if (newNoteIndex == null) {
                    newNoteIndex = (this.noteIndex % 3) + 1;
                }
                this.$refs.editor.save()
                window.heynote.toggleNote(newNoteIndex)
                this.$refs.editor.focus()
            },

            toggleLanguageSelector() {
                this.showLanguageSelector = !this.showLanguageSelector
                this.$refs.editor.focus()
            },

            changeLanguage(language) {
                this.showLanguageSelector = false
                this.$refs.editor.setLanguage(language)
                this.$refs.editor.focus()
            },

            changeTheme(theme) {
                this.$refs.editor.save()
                window.heynote.themeMode.set(theme)
                this.$refs.editor.focus()
            },

            toggleTheme() {
                let newTheme
                // when the "system" theme is used, make sure that the first click always results in amn actual theme change
                if (this.initialTheme === "light") {
                    newTheme = this.themeSetting === "system" ? "dark" : (this.themeSetting === "dark" ? "light" : "system")
                } else {
                    newTheme = this.themeSetting === "system" ? "light" : (this.themeSetting === "light" ? "dark" : "system")
                }
                window.heynote.themeMode.set(newTheme)
                this.themeSetting = newTheme
                this.$refs.editor.focus()
            },

            onCursorChange(e) {
                this.line = e.cursorLine.line
                this.column = e.cursorLine.col
                this.selectionSize = e.selectionSize
                this.language = e.language
                this.languageAuto = e.languageAuto
            },

            openLanguageSelector() {
                this.showLanguageSelector = true
            },

            closeLanguageSelector() {
                this.showLanguageSelector = false
                this.$refs.editor.focus()
            },

            onSelectLanguage(language) {
                this.showLanguageSelector = false
                this.$refs.editor.setLanguage(language)
            },

            formatCurrentBlock() {
                this.$refs.editor.formatCurrentBlock()
            },
        },
    }

</script>

<template>
    <div class="container">
        <Editor 
            @cursorChange="onCursorChange"
            :theme="theme"
            :development="development"
            :debugSyntaxTree="false"
            :keymap="settings.keymap"
            :emacsMetaKey="settings.emacsMetaKey"
            :showLineNumberGutter="settings.showLineNumberGutter"
            :showFoldGutter="settings.showFoldGutter"
            :bracketClosing="settings.bracketClosing"
            :fontFamily="settings.fontFamily"
            :fontSize="settings.fontSize"
            :defaultBlockLanguage="settings.defaultBlockLanguage || 'text'"
            :defaultBlockLanguageAutoDetect="settings.defaultBlockLanguageAutoDetect === undefined ? true : settings.defaultBlockLanguageAutoDetect"
            class="editor"
            ref="editor"
            @openLanguageSelector="openLanguageSelector"
            @toggleNote="toggleNote"
        />
        <StatusBar 
            :noteIndex="noteIndex"
            :line="line" 
            :column="column" 
            :selectionSize="selectionSize"
            :language="language" 
            :languageAuto="languageAuto"
            :theme="theme"
            :themeSetting="themeSetting"
            :autoUpdate="settings.autoUpdate"
            :allowBetaVersions="settings.allowBetaVersions"
            @toggleNote="toggleNote"
            @toggleTheme="toggleTheme"
            @openLanguageSelector="openLanguageSelector"
            @formatCurrentBlock="formatCurrentBlock"
            @openSettings="openSettings"
            class="status" 
        />
        <div class="overlay">
            <LanguageSelector 
                v-if="showLanguageSelector" 
                @selectLanguage="onSelectLanguage"
                @close="closeLanguageSelector"
            />
            <Settings 
                v-if="showSettings"
                :initialSettings="settings"
                @closeSettings="closeSettings"
            />
        </div>
    </div>
</template>

<style scoped lang="sass">
    .container
        width: 100%
        height: 100%
        position: relative
        .editor
            height: calc(100% - 21px)
        .status
            position: absolute
            bottom: 0
            left: 0
</style>
