export interface ExportRow {
  starterTitle: string
  character: string
  rootBlog: string
  rootPostId: string
  partner: string
  status: string
  notes: string
  lastActivityAt: string
}

export function toFormulaSafeCell(value: string): string {
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value
}

function cell(value: string) {
  return `"${toFormulaSafeCell(value).replaceAll('"', '""')}"`
}

export function serializeWorkspaceCsv(rows: ExportRow[]): string {
  const header = ['Starter','Character','Root blog','Root post ID','Partner','Status','Notes','Last activity']
  return [header, ...rows.map(row => [row.starterTitle,row.character,row.rootBlog,row.rootPostId,row.partner,row.status,row.notes,row.lastActivityAt])]
    .map(values => values.map(value => cell(value ?? '')).join(',')).join('\r\n') + '\r\n'
}
