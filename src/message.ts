export type ChatMessageLike = {
  role?: string
  content?: unknown
}

export function getLastUserLedTurn(messages: ChatMessageLike[]): ChatMessageLike[] {
  let idx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      idx = i
      break
    }
  }
  return idx >= 0 ? messages.slice(idx) : messages
}

export function extractText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  const chunks: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') {
      chunks.push(b.text)
    }
  }

  return chunks.join('\n').trim()
}

export function countUserTurns(messages: ChatMessageLike[]): number {
  return messages.filter((m) => m?.role === 'user').length
}

export function latestUserText(messages: ChatMessageLike[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.role === 'user') {
      return extractText(msg.content)
    }
  }
  return ''
}
