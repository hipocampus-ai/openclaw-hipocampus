declare module 'node:crypto' {
  export function createHash(algorithm: string): {
    update(data: string): { digest(encoding: 'hex'): string }
    digest(encoding: 'hex'): string
  }

  export function randomUUID(): string
}

declare const process: {
  env: Record<string, string | undefined>
}
