"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderStocktakeProblemPdf = renderStocktakeProblemPdf;
exports.renderStocktakeSummaryPdf = renderStocktakeSummaryPdf;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const pdfmake_1 = __importDefault(require("pdfmake"));
const COLORS = {
    navy: '#173F72',
    blue: '#245C9B',
    ink: '#18212B',
    muted: '#667384',
    line: '#D3DAE3',
    canvas: '#F3F6F9',
    missing: '#FCE5D7',
    missingAccent: '#B94A28',
    repair: '#FFF1C2',
    repairAccent: '#A46700',
    inactive: '#E5E9EE',
    inactiveAccent: '#596574',
    summaryOk: '#D9EEF7',
    summaryMinor: '#FFF2BD',
    summaryZero: '#F6E3BD',
    summaryLow: '#F7D0B8',
    summaryCritical: '#EFB6A5',
};
function findFont(...candidates) {
    const font = candidates.find((candidate) => fs_1.default.existsSync(candidate));
    if (!font) {
        throw new Error(`PDF font was not found. Checked: ${candidates.join(', ')}`);
    }
    return font;
}
function createFonts() {
    const windowsFonts = path_1.default.join(process.env.WINDIR || 'C:\\Windows', 'Fonts');
    return {
        ReportFont: {
            normal: findFont(path_1.default.join(windowsFonts, 'segoeui.ttf'), '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
            bold: findFont(path_1.default.join(windowsFonts, 'segoeuib.ttf'), '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
            italics: findFont(path_1.default.join(windowsFonts, 'segoeuii.ttf'), '/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
            bolditalics: findFont(path_1.default.join(windowsFonts, 'segoeuiz.ttf'), '/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'),
        },
    };
}
function formatGeneratedAt(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? value
        : new Intl.DateTimeFormat('ru-RU', {
            dateStyle: 'short',
            timeStyle: 'short',
            timeZone: 'Asia/Dubai',
        }).format(date);
}
function summaryCard(value, label, accent) {
    return {
        table: {
            widths: [4, '*'],
            body: [[
                    { text: '', fillColor: accent, border: [false, false, false, false] },
                    {
                        stack: [
                            { text: String(value), fontSize: 17, bold: true, color: COLORS.ink },
                            { text: label, fontSize: 7.5, color: COLORS.muted, margin: [0, 1, 0, 0] },
                        ],
                        fillColor: '#FFFFFF',
                        margin: [7, 5, 7, 5],
                        border: [false, false, false, false],
                    },
                ]],
        },
        layout: 'noBorders',
    };
}
function problemColors(kind) {
    if (kind === 'repair')
        return { fill: COLORS.repair, accent: COLORS.repairAccent };
    if (kind === 'inactive')
        return { fill: COLORS.inactive, accent: COLORS.inactiveAccent };
    return { fill: COLORS.missing, accent: COLORS.missingAccent };
}
function cell(primary, secondary = '', options) {
    const stack = [{
            text: primary || '—',
            bold: options?.bold,
            fontSize: options?.code ? 7.2 : 7.5,
        }];
    if (secondary) {
        stack.push({ text: secondary, color: COLORS.muted, fontSize: 6.4, margin: [0, 1, 0, 0] });
    }
    return {
        stack,
        margin: [4, 3, 4, 3],
    };
}
function buildTableBody(rows) {
    const header = ['Описание', 'Barcode', 'Serial', 'Инвентаризация', 'Текущий статус', 'Последнее наблюдение'].map((label) => ({
        text: label,
        bold: true,
        color: '#FFFFFF',
        fillColor: COLORS.navy,
        fontSize: 7.2,
        margin: [4, 4, 4, 4],
    }));
    return [
        header,
        ...rows.map((row) => {
            const colors = problemColors(row.kind);
            const cells = [
                cell(row.equipmentType),
                cell(row.barcode, '', { code: true }),
                cell(row.serialNumber, '', { code: true }),
                cell(row.inventoryStatus),
                cell(row.currentStatus, row.currentStatusNote, { bold: true }),
                cell(row.lastObservation, row.lastObservationSource),
            ];
            cells.forEach((tableCell, index) => {
                tableCell.fillColor = colors.fill;
                if (index === 0)
                    tableCell.borderColor = [colors.accent, COLORS.line, COLORS.line, COLORS.line];
            });
            return cells;
        }),
    ];
}
function buildDefinition(input) {
    const counts = input.rows.reduce((result, row) => {
        result[row.kind] += 1;
        return result;
    }, { missing: 0, repair: 0, inactive: 0 });
    const generatedAt = formatGeneratedAt(input.generatedAt);
    const titleStack = [
        { text: 'STOCK CHECK', color: '#AFC5DF', bold: true, fontSize: 8, characterSpacing: 1.6 },
        { text: 'Проблемные позиции', color: '#FFFFFF', bold: true, fontSize: 21, margin: [0, 3, 0, 5] },
        { text: input.latestSession, color: '#FFFFFF', fontSize: 9 },
    ];
    if (input.previousSession) {
        titleStack.push({
            text: `Сравнение: ${input.previousSession}`,
            color: '#C9D8E9',
            fontSize: 7.5,
            margin: [0, 2, 0, 0],
        });
    }
    const titleCell = {
        stack: titleStack,
        fillColor: COLORS.navy,
        margin: [16, 12, 16, 12],
        border: [false, false, false, false],
    };
    return {
        pageSize: 'A4',
        pageOrientation: 'landscape',
        pageMargins: [28, 34, 28, 30],
        compress: true,
        defaultStyle: { font: 'ReportFont', color: COLORS.ink, fontSize: 8 },
        info: {
            title: 'Проблемные позиции Stock Check',
            author: 'HireTrack NX Stock Check',
            subject: input.latestSession,
        },
        background: (_currentPage, pageSize) => ({
            canvas: [{ type: 'rect', x: 0, y: 0, w: pageSize.width, h: pageSize.height, color: COLORS.canvas }],
        }),
        header: (currentPage) => currentPage === 1 ? [] : ({
            columns: [
                { text: 'STOCK CHECK  /  ПРОБЛЕМНЫЕ ПОЗИЦИИ', color: COLORS.navy, bold: true, fontSize: 7.5 },
                { text: input.latestSession, alignment: 'right', color: COLORS.muted, fontSize: 7 },
            ],
            margin: [28, 14, 28, 0],
        }),
        footer: (currentPage, pageCount) => ({
            columns: [
                { text: `Сформировано ${generatedAt} · HireTrack NX`, color: COLORS.muted, fontSize: 6.5 },
                { text: `${currentPage} / ${pageCount}`, alignment: 'right', color: COLORS.navy, bold: true, fontSize: 7 },
            ],
            margin: [28, 8, 28, 0],
        }),
        content: [
            {
                table: {
                    widths: ['*'],
                    body: [[titleCell]],
                },
                layout: 'noBorders',
                margin: [0, 0, 0, 10],
            },
            {
                columns: [
                    summaryCard(input.rows.length, 'Всего проблемных позиций', COLORS.blue),
                    summaryCard(counts.missing, 'Не прошли инвентаризацию', COLORS.missingAccent),
                    summaryCard(counts.repair, 'Числятся в ремонте', COLORS.repairAccent),
                    summaryCard(counts.inactive, 'Списано / продано / неактивно', COLORS.inactiveAccent),
                ],
                columnGap: 8,
                margin: [0, 0, 0, 9],
            },
            {
                columns: [
                    { text: 'Цвет строки показывает текущую причину расхождения.', color: COLORS.muted, fontSize: 7 },
                    {
                        text: [
                            { text: 'НЕ ПРОШЁЛ', color: COLORS.missingAccent, bold: true },
                            { text: '    РЕМОНТ', color: COLORS.repairAccent, bold: true },
                            { text: '    НЕАКТИВНО', color: COLORS.inactiveAccent, bold: true },
                        ],
                        alignment: 'right',
                        fontSize: 6.8,
                    },
                ],
                margin: [2, 0, 2, 5],
            },
            {
                table: {
                    headerRows: 1,
                    dontBreakRows: true,
                    widths: ['23%', '10%', '11%', '12%', '25%', '19%'],
                    body: buildTableBody(input.rows),
                },
                layout: {
                    hLineWidth: () => 0.45,
                    vLineWidth: (index) => index === 0 ? 1.6 : 0.45,
                    hLineColor: () => COLORS.line,
                    vLineColor: () => COLORS.line,
                    paddingLeft: () => 0,
                    paddingRight: () => 0,
                    paddingTop: () => 0,
                    paddingBottom: () => 0,
                },
            },
        ],
        styles: {},
    };
}
async function renderStocktakeProblemPdf(input) {
    const printer = new pdfmake_1.default(createFonts());
    const document = printer.createPdfKitDocument(buildDefinition(input));
    const chunks = [];
    return new Promise((resolve, reject) => {
        document.on('data', (chunk) => chunks.push(chunk));
        document.on('end', () => resolve(Buffer.concat(chunks)));
        document.on('error', reject);
        document.end();
    });
}
function summaryLevelColor(level) {
    if (level === 'ok')
        return COLORS.summaryOk;
    if (level === 'minor')
        return COLORS.summaryMinor;
    if (level === 'zero')
        return COLORS.summaryZero;
    if (level === 'low')
        return COLORS.summaryLow;
    return COLORS.summaryCritical;
}
function summaryTextCell(text, fillColor, options) {
    return {
        text,
        fillColor,
        bold: options?.bold,
        alignment: options?.alignment || 'left',
        fontSize: 6.8,
        margin: [3, 3, 3, 3],
    };
}
function buildSummaryTableBody(rows) {
    const labels = [
        'Описание', 'Всего', 'Barcode', 'Активно', 'Ремонт',
        'Видели ранее', 'Видели сейчас', 'Не видели', 'Списано', 'Продано',
    ];
    const header = labels.map((label, index) => ({
        text: label,
        bold: true,
        color: '#FFFFFF',
        fillColor: COLORS.navy,
        alignment: index === 0 ? 'left' : 'center',
        fontSize: 6.7,
        margin: [3, 4, 3, 4],
    }));
    return [
        header,
        ...rows.map((row) => {
            const fillColor = summaryLevelColor(row.level);
            const description = row.equipmentTypeId
                ? `${row.equipmentType}  #${row.equipmentTypeId}`
                : row.equipmentType;
            return [
                summaryTextCell(description, fillColor, { bold: true }),
                summaryTextCell(String(row.total), fillColor, { alignment: 'right' }),
                summaryTextCell(String(row.barcoded), fillColor, { alignment: 'right' }),
                summaryTextCell(String(row.active), fillColor, { alignment: 'right' }),
                summaryTextCell(String(row.repair), fillColor, { alignment: 'right' }),
                summaryTextCell(String(row.previousSeen), fillColor, { alignment: 'right' }),
                summaryTextCell(String(row.latestSeen), fillColor, { alignment: 'right', bold: true }),
                summaryTextCell(String(row.notSeen), fillColor, { alignment: 'right', bold: row.notSeen > 0 }),
                summaryTextCell(String(row.writtenOff), fillColor, { alignment: 'right' }),
                summaryTextCell(String(row.sold), fillColor, { alignment: 'right' }),
            ];
        }),
    ];
}
function buildSummaryDefinition(input) {
    const totals = input.rows.reduce((result, row) => {
        result.items += row.total;
        result.active += row.active;
        result.seen += row.latestSeen;
        result.notSeen += row.notSeen;
        result.repair += row.repair;
        return result;
    }, { items: 0, active: 0, seen: 0, notSeen: 0, repair: 0 });
    const generatedAt = formatGeneratedAt(input.generatedAt);
    const filterParts = [
        `Категория: ${input.category || 'Все категории'}`,
        input.search ? `Поиск: ${input.search}` : '',
        input.hideZero ? 'Строки без штрихкодов скрыты' : '',
    ].filter(Boolean);
    const titleStack = [
        { text: 'STOCK CHECK', color: '#AFC5DF', bold: true, fontSize: 8, characterSpacing: 1.6 },
        { text: 'Текущее состояние склада', color: '#FFFFFF', bold: true, fontSize: 21, margin: [0, 3, 0, 5] },
        { text: input.latestSession, color: '#FFFFFF', fontSize: 9 },
        { text: filterParts.join('  ·  '), color: '#C9D8E9', fontSize: 7.5, margin: [0, 3, 0, 0] },
    ];
    if (input.previousSession) {
        titleStack.push({
            text: `Сравнение: ${input.previousSession}`,
            color: '#C9D8E9',
            fontSize: 7.5,
            margin: [0, 2, 0, 0],
        });
    }
    const titleCell = {
        stack: titleStack,
        fillColor: COLORS.navy,
        margin: [16, 12, 16, 12],
        border: [false, false, false, false],
    };
    return {
        pageSize: 'A4',
        pageOrientation: 'landscape',
        pageMargins: [24, 34, 24, 30],
        compress: true,
        defaultStyle: { font: 'ReportFont', color: COLORS.ink, fontSize: 8 },
        info: {
            title: 'Текущее состояние Stock Check',
            author: 'HireTrack NX Stock Check',
            subject: input.latestSession,
        },
        background: (_currentPage, pageSize) => ({
            canvas: [{ type: 'rect', x: 0, y: 0, w: pageSize.width, h: pageSize.height, color: COLORS.canvas }],
        }),
        header: (currentPage) => currentPage === 1 ? [] : ({
            columns: [
                { text: 'STOCK CHECK  /  ТЕКУЩЕЕ СОСТОЯНИЕ', color: COLORS.navy, bold: true, fontSize: 7.5 },
                { text: input.category || 'Все категории', alignment: 'right', color: COLORS.muted, fontSize: 7 },
            ],
            margin: [24, 14, 24, 0],
        }),
        footer: (currentPage, pageCount) => ({
            columns: [
                { text: `Сформировано ${generatedAt} · HireTrack NX`, color: COLORS.muted, fontSize: 6.5 },
                { text: `${currentPage} / ${pageCount}`, alignment: 'right', color: COLORS.navy, bold: true, fontSize: 7 },
            ],
            margin: [24, 8, 24, 0],
        }),
        content: [
            {
                table: { widths: ['*'], body: [[titleCell]] },
                layout: 'noBorders',
                margin: [0, 0, 0, 10],
            },
            {
                columns: [
                    summaryCard(input.rows.length, 'Типов оборудования', COLORS.blue),
                    summaryCard(totals.items, 'Всего единиц', COLORS.navy),
                    summaryCard(totals.seen, 'Видели сейчас', '#24733F'),
                    summaryCard(totals.notSeen, 'Не видели', COLORS.missingAccent),
                    summaryCard(totals.repair, 'В ремонте', COLORS.repairAccent),
                ],
                columnGap: 7,
                margin: [0, 0, 0, 8],
            },
            {
                columns: [
                    { text: `Активных единиц: ${totals.active}`, color: COLORS.muted, fontSize: 7 },
                    {
                        text: [
                            { text: 'НОРМА', color: COLORS.blue, bold: true },
                            { text: '    НЕ ХВАТАЕТ 1–2', color: '#9A6500', bold: true },
                            { text: '    НЕТ ОСТАТКА', color: '#8B622E', bold: true },
                            { text: '    ДЕФИЦИТ', color: COLORS.missingAccent, bold: true },
                        ],
                        alignment: 'right',
                        fontSize: 6.7,
                    },
                ],
                margin: [2, 0, 2, 5],
            },
            {
                table: {
                    headerRows: 1,
                    dontBreakRows: true,
                    widths: ['31%', '6%', '7%', '7%', '6%', '8%', '8%', '8%', '7%', '6%'],
                    body: buildSummaryTableBody(input.rows),
                },
                layout: {
                    hLineWidth: () => 0.45,
                    vLineWidth: () => 0.45,
                    hLineColor: () => COLORS.line,
                    vLineColor: () => COLORS.line,
                    paddingLeft: () => 0,
                    paddingRight: () => 0,
                    paddingTop: () => 0,
                    paddingBottom: () => 0,
                },
            },
        ],
        styles: {},
    };
}
async function renderStocktakeSummaryPdf(input) {
    const printer = new pdfmake_1.default(createFonts());
    const document = printer.createPdfKitDocument(buildSummaryDefinition(input));
    const chunks = [];
    return new Promise((resolve, reject) => {
        document.on('data', (chunk) => chunks.push(chunk));
        document.on('end', () => resolve(Buffer.concat(chunks)));
        document.on('error', reject);
        document.end();
    });
}
