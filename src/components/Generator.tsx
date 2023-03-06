import { createEffect, createSignal, For, onMount, Show } from "solid-js"
import MessageItem from "./MessageItem"
import type { ChatMessage } from "~/types"
import Setting from "./Setting"
import PromptList from "./PromptList"
import prompts from "~/prompts"
import { Fzf } from "fzf"

const defaultSetting = {
  continuousDialogue: true,
  archiveSession: false,
  openaiAPIKey: "",
  openaiAPITemperature: 60,
  systemRule: ""
}

export interface PromptItem {
  desc: string
  prompt: string
}

export type Setting = typeof defaultSetting

export default function () {
  let inputRef: HTMLTextAreaElement
  const [messageList, setMessageList] = createSignal<ChatMessage[]>([
    // {
    //   role: "system",
    //   content: `
    // \`\`\`js
    // console.log("Hello World")
    // `
    // }
  ])
  const [currentAssistantMessage, setCurrentAssistantMessage] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [controller, setController] = createSignal<AbortController>()
  const [setting, setSetting] = createSignal(defaultSetting)
  const [compatiblePrompt, setCompatiblePrompt] = createSignal<PromptItem[]>([])
  const fzf = new Fzf(prompts, { selector: k => `${k.desc} (${k.prompt})` })

  onMount(() => {
    const storage = localStorage.getItem("setting")
    const session = localStorage.getItem("session")
    try {
      let archiveSession = false
      if (storage) {
        const parsed = JSON.parse(storage)
        archiveSession = parsed.archiveSession
        setSetting({
          ...defaultSetting,
          ...parsed
          // continuousDialogue: false
        })
      }
      if (session && archiveSession) {
        setMessageList(JSON.parse(session))
      }
    } catch {
      console.log("Setting parse error")
    }
  })

  createEffect(() => {
    localStorage.setItem("setting", JSON.stringify(setting()))
  })
  createEffect(() => {
    if (setting().archiveSession)
      localStorage.setItem("session", JSON.stringify(messageList()))
  })
  function archiveCurrentMessage() {
    if (currentAssistantMessage()) {
      setMessageList([
        ...messageList(),
        {
          role: "assistant",
          content: currentAssistantMessage()
        }
      ])
      setCurrentAssistantMessage("")
      setLoading(false)
      setController()
      // inputRef.focus()
    }
  }
  async function handleButtonClick(value?: string) {
    const inputValue = value ?? inputRef.value
    if (!inputValue) {
      return
    }
    // @ts-ignore
    if (window?.umami) umami.trackEvent("chat_generate")
    inputRef.value = ""
    setCompatiblePrompt([])
    setHeight("3em")
    if (
      !value ||
      value !==
        messageList()
          .filter(k => k.role === "user")
          .at(-1)?.content
    ) {
      setMessageList([
        ...messageList(),
        {
          role: "user",
          content: inputValue
        }
      ])
    }
    try {
      await fetchGPT(inputValue)
    } catch (error) {
      setCurrentAssistantMessage(
        String(error).includes("The user aborted a request")
          ? ""
          : String(error)
      )
    }
    archiveCurrentMessage()
  }
  async function fetchGPT(inputValue: string) {
    setLoading(true)
    const controller = new AbortController()
    setController(controller)
    const systemRule = setting().systemRule.trim()
    const message = {
      role: "user",
      content: systemRule ? systemRule + "\n" + inputValue : inputValue
    }
    const response = await fetch("/api/stream", {
      method: "POST",
      body: JSON.stringify({
        messages: setting().continuousDialogue
          ? [...messageList().slice(0, -1), message]
          : [message],
        key: setting().openaiAPIKey,
        temperature: setting().openaiAPITemperature / 100
      }),
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(response.statusText)
    }
    const data = response.body
    if (!data) {
      throw new Error("没有返回数据")
    }
    const reader = data.getReader()
    const decoder = new TextDecoder("utf-8")
    let done = false

    while (!done) {
      const { value, done: readerDone } = await reader.read()
      if (value) {
        let char = decoder.decode(value)
        if (char === "\n" && currentAssistantMessage().endsWith("\n")) {
          continue
        }
        if (char) {
          setCurrentAssistantMessage(currentAssistantMessage() + char)
        }
      }
      done = readerDone
    }
  }

  function clear() {
    inputRef.value = ""
    setMessageList([])
    setCurrentAssistantMessage("")
    setCompatiblePrompt([])
  }

  function stopStreamFetch() {
    if (controller()) {
      controller()?.abort()
      archiveCurrentMessage()
    }
  }

  function reAnswer() {
    handleButtonClick(
      messageList()
        .filter(k => k.role === "user")
        .at(-1)?.content
    )
  }

  function selectPrompt(prompt: string) {
    inputRef.value = prompt
    // setHeight("3em")
    setHeight(inputRef.scrollHeight + "px")
    setCompatiblePrompt([])
  }

  const [height, setHeight] = createSignal("3em")

  return (
    <div mt-6>
      <For each={messageList()}>
        {message => (
          <MessageItem role={message.role} message={message.content} />
        )}
      </For>
      {currentAssistantMessage() && (
        <MessageItem role="assistant" message={currentAssistantMessage} />
      )}
      <div mb-6>
        <Show
          when={!loading()}
          fallback={() => (
            <div class="h-12 my-4 flex items-center justify-center bg-slate bg-op-15 text-slate rounded">
              <span>AI 正在思考...</span>
              <div
                class="ml-1em px-2 py-0.5 border border-slate text-slate rounded-md text-sm op-70 cursor-pointer hover:bg-slate/10"
                onClick={stopStreamFetch}
              >
                不需要了
              </div>
            </div>
          )}
        >
          <div class="mt-4 flex items-end">
            <textarea
              ref={inputRef!}
              id="input"
              placeholder="与 ta 对话吧"
              autocomplete="off"
              autofocus
              onKeyDown={e => {
                if (compatiblePrompt().length) {
                  if (
                    e.key === "ArrowUp" ||
                    e.key === "ArrowDown" ||
                    e.key === "Enter"
                  ) {
                    e.preventDefault()
                  }
                } else if (e.key === "Enter") {
                  if (!e.shiftKey && !e.isComposing) {
                    handleButtonClick()
                  }
                }
              }}
              onInput={e => {
                setHeight("3em")
                setHeight(
                  (e.currentTarget as HTMLTextAreaElement).scrollHeight + "px"
                )
                let { value } = e.currentTarget
                if (value === "") return setCompatiblePrompt([])
                if (value === "/") return setCompatiblePrompt(prompts)
                const promptKey = value.replace(/^\/(.*)/, "$1")
                if (promptKey !== value)
                  setCompatiblePrompt(fzf.find(promptKey).map(k => k.item))
              }}
              style={{
                height: height(),
                "border-bottom-left-radius":
                  compatiblePrompt().length === 0 ? "0.25rem" : 0
              }}
              class="self-end py-3 resize-none w-full px-3 text-slate bg-slate bg-op-15 focus:bg-op-20 focus:ring-0 focus:outline-none placeholder:text-slate-400 placeholder:op-30"
              rounded-l
            />
            <div
              class="flex text-slate bg-slate bg-op-15 h-3em items-center rounded-r"
              style={{
                "border-bottom-right-radius":
                  compatiblePrompt().length === 0 ? "0.25rem" : 0
              }}
            >
              <button
                title="发送"
                onClick={() => handleButtonClick()}
                class="i-carbon:send-filled text-5 mx-3 hover:text-slate-2"
              />
            </div>
          </div>
          <Show when={compatiblePrompt().length}>
            <PromptList
              prompts={compatiblePrompt()}
              select={selectPrompt}
            ></PromptList>
          </Show>
        </Show>
      </div>
      <Setting
        setting={setting}
        setSetting={setSetting}
        clear={clear}
        reAnswer={reAnswer}
      />
    </div>
  )
}
