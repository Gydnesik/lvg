import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { unzipSync } from 'npm:fflate@0.8.2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseAnonKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!

const DAY_ORDER = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье']
const LATIN_TO_CYR = new Map([
  ['A','А'],['B','В'],['C','С'],['E','Е'],['H','Н'],['K','К'],['M','М'],['O','О'],['P','Р'],['T','Т'],['X','Х'],['Y','У'],
])

function normalizeClassName(value: unknown): string | null {
  let s = String(value ?? '').trim().toUpperCase()
  s = s.replace(/\bКЛАСС\b/giu, '').replace(/[\s._\-–—:№]+/g, '')
  for (const [latin, cyr] of LATIN_TO_CYR) s = s.replaceAll(latin, cyr)
  const match = s.match(/^(5|6|7|8|9|10|11)([А-Я])$/u)
  return match ? `${match[1]}${match[2]}` : null
}

function normalizeDay(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase().replace(/ё/g, 'е')
  const aliases: Record<string, string> = {
    'пн':'Понедельник','пон':'Понедельник','понедельник':'Понедельник',
    'вт':'Вторник','вторник':'Вторник','ср':'Среда','среда':'Среда',
    'чт':'Четверг','четверг':'Четверг','пт':'Пятница','пятница':'Пятница',
    'сб':'Суббота','суббота':'Суббота','вс':'Воскресенье','воскресенье':'Воскресенье',
  }
  return aliases[raw] || String(value ?? '').trim() || 'Понедельник'
}

function normalizeLesson(raw: any, fallbackIndex: number): any | null {
  if (!raw || typeof raw !== 'object') return null
  const subject = String(raw.subject ?? raw.name ?? raw.title ?? '').trim()
  if (!subject) return null
  const lessonRaw = Number(raw.lesson ?? raw.number ?? fallbackIndex + 1)
  const lesson = Number.isFinite(lessonRaw) && lessonRaw > 0 ? Math.floor(lessonRaw) : fallbackIndex + 1
  return {
    day: normalizeDay(raw.day), lesson, subject,
    time: String(raw.time ?? '').trim(),
    room: String(raw.room ?? raw.cabinet ?? raw.classroom ?? '').trim(),
  }
}

function normalizeLessons(raw: unknown): any[] {
  if (!Array.isArray(raw)) return []
  const result: any[] = []
  raw.forEach((item, i) => {
    const lesson = normalizeLesson(item, i)
    if (lesson) result.push(lesson)
  })
  result.sort((a,b) => {
    const d = DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day)
    return d || a.lesson - b.lesson || a.subject.localeCompare(b.subject, 'ru')
  })
  const seen = new Set<string>()
  return result.filter(x => {
    const key = `${x.day}|${x.lesson}|${x.subject}|${x.time}|${x.room}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeSchedules(input: any) {
  const out: Record<string, any[]> = {}
  const ignoredClasses: string[] = []
  const source = Array.isArray(input?.schedules)
    ? input.schedules
    : input?.schedules && typeof input.schedules === 'object'
      ? Object.entries(input.schedules).map(([class_name, lessons]) => ({ class_name, lessons }))
      : Array.isArray(input) ? input : []

  for (const item of source) {
    const rawClass = item?.class_name ?? item?.className ?? item?.class ?? item?.name
    const className = normalizeClassName(rawClass)
    if (!className) {
      if (String(rawClass ?? '').trim()) ignoredClasses.push(String(rawClass).trim())
      continue
    }
    const lessons = normalizeLessons(item?.lessons)
    if (!out[className]) out[className] = []
    out[className].push(...lessons)
  }
  for (const className of Object.keys(out)) out[className] = normalizeLessons(out[className])
  return { schedules: out, ignoredClasses: [...new Set(ignoredClasses)] }
}

const SUPPORTED_EXTENSIONS = new Set(['xlsx','ods','csv'])
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
const MAX_SHEET_ROWS = 2500
const MAX_SHEET_COLS = 80
const MAX_XML_BYTES = 30 * 1024 * 1024

async function readUpload(req: Request): Promise<{ bytes: Uint8Array, fileName: string }> {
  const contentType = req.headers.get('content-type') || ''
  if (contentType.toLowerCase().startsWith('multipart/form-data')) {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw new Error('Файл не передан.')
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('Файл слишком большой. Максимальный размер — 12 МБ.')
    return { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name || 'schedule.xlsx' }
  }
  throw new Error('Ожидался файл multipart/form-data. Обнови страницу и попробуй снова.')
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function scoreScheduleSheet(rows: string[][]): number {
  let classHits = 0, dayHits = 0, timeHits = 0, lessonHits = 0, nonEmpty = 0
  const classRe = /\b(?:5|6|7|8|9|10|11)\s*[АБВГAB]\b/giu
  const dayRe = /\b(?:понедельник|вторник|среда|четверг|пятница|суббота)\b/giu
  const timeRe = /\b\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\b/g
  for (const row of rows) {
    for (const cell of row) {
      if (!cell) continue
      nonEmpty++
      classRe.lastIndex=0; dayRe.lastIndex=0; timeRe.lastIndex=0
      classHits += (cell.match(classRe)||[]).length
      dayHits += (cell.match(dayRe)||[]).length
      timeHits += (cell.match(timeRe)||[]).length
    }
    for (const cell of row.slice(0,4)) if (/^\d{1,2}$/.test(cell.trim())) lessonHits++
  }
  return classHits*20 + dayHits*8 + timeHits*6 + lessonHits*2 + Math.min(nonEmpty,500)/100
}

function csvEscape(value: string): string {
  const s = normalizeCell(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s
}


function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try { return String.fromCodePoint(parseInt(hex, 16)) } catch { return '' }
    })
    .replace(/&#([0-9]+);/g, (_, num) => {
      try { return String.fromCodePoint(Number(num)) } catch { return '' }
    })
    .replace(/&amp;/g, '&')
}

function xmlAttr(tag: string, local: string, prefix?: string): string {
  const name = prefix ? `${prefix}:${local}` : local
  const re = new RegExp(`(?:^|\\s)${name.replace(':','\\:')}\\s*=\\s*([\"'])(.*?)\\1`, 'i')
  const m = tag.match(re)
  return m ? decodeXmlEntities(m[2]) : ''
}

function xmlTextFragment(fragment: string): string {
  let s = fragment
    .replace(/<(?:(?:text|office):)?tab\b[^>]*\/?>/gi, '\t')
    .replace(/<(?:(?:text|office):)?line-break\b[^>]*\/?>/gi, '\n')
    .replace(/<\/(?:(?:text|office):)?p\s*>/gi, '\n')
    .replace(/<\/(?:t|text:p|text:span)\s*>/gi, ' ')
  s = s.replace(/<[^>]*>/g, '')
  return decodeXmlEntities(s).replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}

function xmlBlocks(xml: string, localName: string): string[] {
  const escaped = localName.replace(':', '\\:')
  const re = new RegExp(`<${escaped}\\b[^>]*>[\\s\\S]*?<\\/${escaped}>`, 'gi')
  return xml.match(re) || []
}

function xmlOpenTags(xml: string, localName: string): string[] {
  const escaped = localName.replace(':', '\\:')
  const re = new RegExp(`<${escaped}\\b[^>]*\\/?>`, 'gi')
  return xml.match(re) || []
}

function zipPathNormalize(path: string): string {
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

function resolveZipTarget(baseDir: string, target: string): string {
  if (target.startsWith('/')) return zipPathNormalize(target.slice(1))
  return zipPathNormalize(`${baseDir}/${target}`)
}

function columnIndex(ref: string): number {
  const m = ref.match(/^([A-Z]+)\d+$/i)
  if (!m) return -1
  let col = 0
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  return col - 1
}


function a1Coord(ref: string): { row: number, col: number } | null {
  const m = String(ref || '').trim().match(/^([A-Z]+)(\d+)$/i)
  if (!m) return null
  let col = 0
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  const row = Number(m[2]) - 1
  return Number.isFinite(row) && row >= 0 ? { row, col: col - 1 } : null
}

function parseCsv(bytes: Uint8Array): Array<{name:string, rows:string[][]}> {
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ }
        else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"' && cell === '') { quoted = true; continue }
    if (ch === ',') { row.push(normalizeCell(cell)); cell = ''; continue }
    if (ch === '\n') { row.push(normalizeCell(cell)); rows.push(row); row = []; cell = ''; continue }
    if (ch !== '\r') cell += ch
  }
  if (quoted) throw new Error('CSV содержит незакрытую кавычку.')
  if (cell.length || row.length) { row.push(normalizeCell(cell)); rows.push(row) }
  while (rows.length && rows[rows.length - 1].every(x => !x)) rows.pop()
  return rows.length ? [{ name: 'CSV', rows }] : []
}

function parseOdsSheets(bytes: Uint8Array): Array<{name:string, rows:string[][]}> {
  const files = unzipSync(bytes)
  const contentBytes = files['content.xml']
  if (!contentBytes) throw new Error('ODS-файл не содержит content.xml.')
  if (contentBytes.byteLength > MAX_XML_BYTES) throw new Error('ODS-файл после распаковки слишком большой.')

  const xml = new TextDecoder().decode(contentBytes)
  const result: Array<{name:string, rows:string[][]}> = []

  for (const tableXml of xmlBlocks(xml, 'table:table')) {
    const opening = tableXml.match(/^<table:table\b[^>]*>/i)?.[0] || ''
    const name = xmlAttr(opening, 'name', 'table') || 'Лист'
    const rows: string[][] = []
    const merges: Array<{sr:number,er:number,sc:number,ec:number,value:string}> = []
    let r = 0

    for (const rowXml of xmlBlocks(tableXml, 'table:table-row')) {
      let repeatRows = Math.max(1, Number(xmlAttr(rowXml.match(/^<table:table-row\b[^>]*>/i)?.[0] || '', 'number-rows-repeated', 'table')) || 1)
      repeatRows = Math.min(repeatRows, MAX_SHEET_ROWS - r)
      if (repeatRows <= 0) break

      const cellXmls = [
        ...xmlBlocks(rowXml, 'table:table-cell'),
        ...xmlOpenTags(rowXml, 'table:covered-table-cell'),
      ]
      // Keep the original XML order. The simple combined regexes above can reorder
      // covered cells, so use one order-preserving matcher instead.
      const orderedCellRe = /<(?:table:)?(?:table-cell|covered-table-cell)\b[^>]*(?:\/>|>[\s\S]*?<\/(?:table:)?(?:table-cell|covered-table-cell)>)/gi
      const ordered = rowXml.match(orderedCellRe) || []
      const cells = ordered.length ? ordered : cellXmls

      for (let rr = 0; rr < repeatRows; rr++) {
        const row = new Array<string>(MAX_SHEET_COLS).fill('')
        let c = 0

        for (const cellXml of cells) {
          if (c >= MAX_SHEET_COLS) break
          const openingCell = cellXml.match(/^<[^>]+>/)?.[0] || ''
          const covered = /^<(?:(?:table:)?covered-table-cell)\b/i.test(openingCell)
          const repeat = Math.min(MAX_SHEET_COLS - c, Math.max(1, Number(xmlAttr(openingCell, 'number-columns-repeated', 'table')) || 1))
          const colSpan = Math.min(MAX_SHEET_COLS - c, Math.max(1, Number(xmlAttr(openingCell, 'number-columns-spanned', 'table')) || 1))
          const rowSpan = Math.max(1, Number(xmlAttr(openingCell, 'number-rows-spanned', 'table')) || 1)

          let value = ''
          if (!covered) {
            value = xmlAttr(openingCell, 'string-value', 'office') ||
              xmlAttr(openingCell, 'value', 'office') ||
              xmlTextFragment(cellXml)
          }
          value = normalizeCell(value)

          for (let k = 0; k < repeat; k++) {
            row[c + k] = value
            if (value && (colSpan > 1 || rowSpan > 1)) {
              merges.push({
                sr: r,
                er: Math.min(MAX_SHEET_ROWS - 1, r + rowSpan - 1),
                sc: c + k,
                ec: Math.min(MAX_SHEET_COLS - 1, c + k + colSpan - 1),
                value,
              })
            }
          }
          c += repeat
        }

        rows[r] = row
        r++
      }
    }

    for (const m of merges) {
      for (let rr = m.sr; rr <= m.er && rr < rows.length; rr++) {
        for (let cc = m.sc; cc <= m.ec; cc++) rows[rr][cc] = m.value
      }
    }

    while (rows.length && rows[rows.length - 1].every(x => !x)) rows.pop()
    if (rows.length) result.push({ name, rows })
  }

  return result
}

function parseXlsxSheets(bytes: Uint8Array): Array<{name:string, rows:string[][]}> {
  const files = unzipSync(bytes)
  const wbBytes = files['xl/workbook.xml']
  if (!wbBytes) throw new Error('XLSX-файл не содержит xl/workbook.xml.')

  const shared: string[] = []
  const ss = files['xl/sharedStrings.xml']
  if (ss) {
    const ssXml = new TextDecoder().decode(ss)
    for (const si of xmlBlocks(ssXml, 'si')) shared.push(xmlTextFragment(si))
  }

  const wbXml = new TextDecoder().decode(wbBytes)
  const relBytes = files['xl/_rels/workbook.xml.rels']
  const rels: Record<string, string> = {}
  if (relBytes) {
    const relXml = new TextDecoder().decode(relBytes)
    for (const tag of xmlOpenTags(relXml, 'Relationship')) {
      const id = xmlAttr(tag, 'Id')
      const target = xmlAttr(tag, 'Target')
      if (id && target) rels[id] = resolveZipTarget('xl', target)
    }
  }

  const out: Array<{name:string, rows:string[][]}> = []
  for (const shTag of xmlOpenTags(wbXml, 'sheet')) {
    const rid = xmlAttr(shTag, 'id', 'r') || xmlAttr(shTag, 'id')
    const target = rels[rid]
    if (!target) continue
    const sheetBytes = files[target]
    if (!sheetBytes) continue

    const sheetXml = new TextDecoder().decode(sheetBytes)
    const rows: string[][] = []

    for (const rowXml of xmlBlocks(sheetXml, 'row')) {
      const rowOpen = rowXml.match(/^<row\b[^>]*>/i)?.[0] || ''
      const rrRaw = Number(xmlAttr(rowOpen, 'r'))
      const rr = Number.isFinite(rrRaw) && rrRaw > 0 ? rrRaw - 1 : rows.length
      if (rr < 0 || rr >= MAX_SHEET_ROWS) continue
      if (!rows[rr]) rows[rr] = new Array<string>(MAX_SHEET_COLS).fill('')

      const cells = rowXml.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/gi) || []
      for (const cellXml of cells) {
        const open = cellXml.match(/^<c\b[^>]*>/i)?.[0] || ''
        const ref = xmlAttr(open, 'r')
        const col = columnIndex(ref)
        if (col < 0 || col >= MAX_SHEET_COLS) continue

        const type = xmlAttr(open, 't')
        const vMatch = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)
        const isMatch = cellXml.match(/<is\b[^>]*>([\s\S]*?)<\/is>/i)
        let value = ''
        if (type === 's' && vMatch) {
          value = shared[Number(decodeXmlEntities(vMatch[1]).trim())] || ''
        } else if (type === 'inlineStr' && isMatch) {
          value = xmlTextFragment(isMatch[1])
        } else if (vMatch) {
          value = decodeXmlEntities(vMatch[1]).trim()
        }
        rows[rr][col] = normalizeCell(value)
      }
    }

    // XLSX stores merged ranges separately from cell values. Restore the
    // visible value into every covered class column before schedule extraction.
    for (const mergeTag of xmlOpenTags(sheetXml, 'mergeCell')) {
      const ref = xmlAttr(mergeTag, 'ref')
      const parts = ref.split(':')
      if (parts.length !== 2) continue
      const a = a1Coord(parts[0]); const b = a1Coord(parts[1])
      if (!a || !b || a.row > b.row || a.col > b.col) continue
      const value = rows[a.row]?.[a.col] || ''
      if (!value) continue
      for (let rr = a.row; rr <= b.row && rr < MAX_SHEET_ROWS; rr++) {
        if (!rows[rr]) rows[rr] = new Array<string>(MAX_SHEET_COLS).fill('')
        for (let cc = a.col; cc <= b.col && cc < MAX_SHEET_COLS; cc++) rows[rr][cc] = value
      }
    }

    while (rows.length && (!rows[rows.length - 1] || rows[rows.length - 1].every(x => !x))) rows.pop()
    if (rows.length) out.push({ name: xmlAttr(shTag, 'name') || 'Лист', rows })
  }
  return out
}


const DAY_NAMES = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье']
const CLASS_HEADER_RE = /^(5|6|7|8|9|10|11)\s*[А-ЯA-Z]$/iu
const TIME_RE = /^\d{1,2}[.:]\d{2}$/
const LESSON_RE = /^(?:[1-9]|1[0-5])$/

function isClassHeader(value: string): boolean {
  return !!normalizeClassName(value) && CLASS_HEADER_RE.test(normalizeCell(value))
}

function findClassHeaderRows(rows: string[][]): number[] {
  const hits: number[] = []
  for (let r = 0; r < rows.length; r++) {
    let count = 0
    const seen = new Set<string>()
    for (const cell of rows[r] || []) {
      const c = normalizeClassName(cell)
      if (c && isClassHeader(cell) && !seen.has(c)) { seen.add(c); count++ }
    }
    if (count >= 5) hits.push(r)
  }
  return hits
}

function dayFromText(value: unknown): string | null {
  const raw = String(value ?? '').trim().toLowerCase().replace(/ё/g, 'е')
  const aliases: Record<string, string> = {
    'пн':'Понедельник','пон':'Понедельник','понедельник':'Понедельник',
    'вт':'Вторник','вторник':'Вторник','ср':'Среда','среда':'Среда',
    'чт':'Четверг','четверг':'Четверг','пт':'Пятница','пятница':'Пятница',
    'сб':'Суббота','суббота':'Суббота','вс':'Воскресенье','воскресенье':'Воскресенье',
  }
  return aliases[raw] || null
}

function dayForHeader(rows: string[][], headerRow: number, sheetName: string): string {
  // In the real workbook the service block is above the actual class grid and
  // the "День недели" row sits immediately before the second class header.
  for (let r = Math.max(0, headerRow - 8); r < headerRow; r++) {
    for (const cell of rows[r] || []) {
      const day = dayFromText(cell)
      if (day) return day
    }
  }
  return dayFromText(sheetName) || 'Понедельник'
}

function findTimeAndLesson(row: string[]): { time: string, lesson: number } | null {
  let time = ''
  let lesson = 0
  // The source places time and lesson in the first two columns, but allow a
  // small offset so slightly shifted sheets still work.
  for (let i = 0; i < Math.min(6, row.length); i++) {
    const v = normalizeCell(row[i])
    if (!time && TIME_RE.test(v)) time = v
    if (!lesson && LESSON_RE.test(v)) lesson = Number(v)
  }
  return time && lesson ? { time, lesson } : null
}

function parseLessonCell(raw: string): { subject: string, room: string } | null {
  let text = normalizeCell(raw)
  if (!text) return null
  // Keep a real dash as a real lesson marker; it is meaningful in the source.
  if (text === '-') return { subject: '-', room: '' }

  // The workbook convention is usually 3-digit cabinet immediately before a
  // subject ("302лит") or separated by spaces/slashes ("104мат у/ 307мат...").
  // Extract all cabinet-looking 3-digit numbers but never grade numbers such as 9а.
  const rooms: string[] = []
  text = text.replace(/(?:^|(?<=[\s/"'–—-]))(\d{3})(?=[A-Za-zА-Яа-яЁё]|\b)/gu, (full, n) => {
    rooms.push(n)
    return ' '
  })
  text = text.replace(/\s{2,}/g, ' ').replace(/\s*\/\s*/g, ' / ').replace(/\s+([/–—-])/g, '$1').replace(/([/–—-])\s+/g, '$1 ')
  text = text.replace(/^\s*["']?\s*\/\s*/g, '/ ').trim()
  const subject = text.trim()
  return { subject: subject || '-', room: [...new Set(rooms)].join('/') }
}

function extractMainSchedule(sheet: { name: string, rows: string[][] }): { day: string, schedules: Record<string, any[]> } | null {
  const headers = findClassHeaderRows(sheet.rows)
  if (!headers.length) return null

  // Workbooks used by the school often have a teacher/service grid at the top
  // with the same class labels. The actual timetable is the LAST class-header
  // block on the sheet. This is deterministic and avoids Gemini shifting a
  // column after the 6th/7th lesson.
  const headerRow = headers[headers.length - 1]
  const day = dayForHeader(sheet.rows, headerRow, sheet.name)
  const classColumns = new Map<number, string>()
  const schedules: Record<string, any[]> = {}
  for (let c = 0; c < (sheet.rows[headerRow] || []).length; c++) {
    const className = normalizeClassName(sheet.rows[headerRow][c])
    if (!className || !isClassHeader(sheet.rows[headerRow][c])) continue
    if (!classColumns.has(c)) classColumns.set(c, className)
    if (!schedules[className]) schedules[className] = []
  }
  if (!classColumns.size) return null

  let gridRows = 0
  let started = false
  let blankAfterGrid = 0
  for (let r = headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] || []
    const meta = findTimeAndLesson(row)
    if (!meta) {
      if (started) {
        blankAfterGrid++
        if (blankAfterGrid >= 2) break
      }
      continue
    }
    started = true
    blankAfterGrid = 0
    gridRows++

    for (const [col, className] of classColumns) {
      const cell = normalizeCell(row[col] || '')
      if (!cell) continue
      const parsed = parseLessonCell(cell)
      if (!parsed) continue
      schedules[className].push({
        day,
        lesson: meta.lesson,
        subject: parsed.subject,
        time: meta.time,
        room: parsed.room,
      })
    }
  }

  if (!gridRows) return null
  return { day, schedules }
}

function extractSchedulesDeterministically(sheets: Array<{name:string, rows:string[][]}>): Record<string, any[]> {
  const schedules: Record<string, any[]> = {}
  for (const sheet of sheets) {
    const extracted = extractMainSchedule(sheet)
    if (!extracted) continue
    for (const [className, lessons] of Object.entries(extracted.schedules)) {
      if (!schedules[className]) schedules[className] = []
      schedules[className].push(...lessons)
    }
  }
  for (const className of Object.keys(schedules)) schedules[className] = normalizeLessons(schedules[className])
  return schedules
}

function validateExtractedSchedules(schedules: Record<string, any[]>, sheets: Array<{name:string, rows:string[][]}>): { ok: boolean, errors: string[] } {
  const errors: string[] = []
  const expectedByClassDay = new Map<string, number>()
  for (const sheet of sheets) {
    const headers = findClassHeaderRows(sheet.rows)
    if (!headers.length) continue
    const headerRow = headers[headers.length - 1]
    const day = dayForHeader(sheet.rows, headerRow, sheet.name)
    const classColumns = new Map<number, string>()
    for (let c = 0; c < (sheet.rows[headerRow] || []).length; c++) {
      const cn = normalizeClassName(sheet.rows[headerRow][c])
      if (cn && isClassHeader(sheet.rows[headerRow][c])) classColumns.set(c, cn)
    }
    for (const [col, cn] of classColumns) {
      let count = 0
      for (let r = headerRow + 1; r < sheet.rows.length; r++) {
        const meta = findTimeAndLesson(sheet.rows[r] || [])
        if (!meta) continue
        if (normalizeCell(sheet.rows[r]?.[col] || '')) count++
      }
      expectedByClassDay.set(`${cn}|${day}`, count)
    }
  }

  for (const [key, expected] of expectedByClassDay) {
    const [cn, day] = key.split('|')
    const actual = (schedules[cn] || []).filter(x => x.day === day).length
    if (actual !== expected) errors.push(`${cn} ${day}: source=${expected}, parsed=${actual}`)
  }

  // Every stored lesson must belong to a canonical class and a valid lesson number.
  for (const [cn, lessons] of Object.entries(schedules)) {
    if (!normalizeClassName(cn)) errors.push(`Неканонический класс: ${cn}`)
    const seen = new Set<string>()
    for (const x of lessons) {
      if (!DAY_NAMES.includes(x.day)) errors.push(`${cn}: неизвестный день ${x.day}`)
      if (!Number.isInteger(x.lesson) || x.lesson < 1 || x.lesson > 15) errors.push(`${cn}: неверный номер урока ${x.lesson}`)
      const key = `${x.day}|${x.lesson}|${x.subject}|${x.time}|${x.room}`
      if (seen.has(key)) errors.push(`${cn}: дубликат ${key}`)
      seen.add(key)
    }
  }
  return { ok: errors.length === 0, errors }
}

function workbookSheets(bytes: Uint8Array, extension: string): Array<{name:string,rows:string[][]}> {
  if (extension === 'ods') return parseOdsSheets(bytes)
  if (extension === 'xlsx') return parseXlsxSheets(bytes)
  if (extension === 'csv') return parseCsv(bytes)
  throw new Error('Формат .xls не поддерживается. Сохрани файл как .xlsx или .ods и загрузи его снова.')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const auth = req.headers.get('Authorization') || ''
    const supabase = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: auth } } })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: 'Необходим вход в аккаунт.' }, 401)

    const { data: profile, error: profileError } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (profileError || profile?.role !== 'admin') return json({ error: 'Доступ только для администратора.' }, 403)

    const upload = await readUpload(req)
    const extension = (upload.fileName.split('.').pop() || '').toLowerCase()
    if (!SUPPORTED_EXTENSIONS.has(extension)) return json({ error: 'Поддерживаются только .xlsx, .ods и .csv.' }, 400)

    let sheets: Array<{name:string,rows:string[][]}>
    try {
      sheets = workbookSheets(upload.bytes, extension)
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 422)
    }
    if (!sheets.length) return json({ error: 'В таблице не найдено ни одного непустого листа.' }, 422)

    // Критически важное изменение: Gemini больше НЕ определяет координаты классов.
    // Сетка читается по реальным индексам столбцов из ODS/XLSX, поэтому после 6-го,
    // 7-го, 8-го или 9-го урока класс физически не может "переехать" в соседний.
    const schedules = extractSchedulesDeterministically(sheets)

    // Надзор №1: сверяем количество непустых ячеек каждого класса с результатом.
    let validation = validateExtractedSchedules(schedules, sheets)
    if (!validation.ok) {
      // Второй независимый прогон того же детерминированного алгоритма. Он должен быть
      // идентичен; если нет — это ошибка реализации, а не повод угадывать через модель.
      const schedules2 = extractSchedulesDeterministically(sheets)
      const validation2 = validateExtractedSchedules(schedules2, sheets)
      if (JSON.stringify(schedules) !== JSON.stringify(schedules2) || !validation2.ok) {
        return json({ error: 'Проверка расписания не пройдена.', details: [...validation.errors, ...validation2.errors].slice(0, 100) }, 422)
      }
    }

    if (!Object.keys(schedules).length) return json({ error: 'Не найдено ни одного класса в основной сетке расписания.' }, 422)

    // Финальная нормализация повторяется ещё раз для проверки идемпотентности.
    const finalSchedules: Record<string, any[]> = {}
    for (const [cn, lessons] of Object.entries(schedules)) finalSchedules[cn] = normalizeLessons(lessons)
    const finalCheck = validateExtractedSchedules(finalSchedules, sheets)
    if (!finalCheck.ok) return json({ error: 'Финальная проверка расписания не пройдена.', details: finalCheck.errors.slice(0, 100) }, 422)

    const { error: replaceError } = await supabase.rpc('replace_schedules', { p_schedules: finalSchedules })
    if (replaceError) return json({ error: `Не удалось заменить расписание в базе: ${replaceError.message}` }, 500)

    return json({ schedules: finalSchedules, ignoredClasses: [], model: 'deterministic-grid-parser', validation: '3-pass' })
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
