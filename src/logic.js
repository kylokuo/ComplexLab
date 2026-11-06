export const COMPLEXES = {
  I: {
    id: 'I',
    label: 'Complex I',
    name: 'NADH-CoQ 还原酶',
    kit: 'E-BC-K149-M',
    wavelength: '340 nm',
    unit: 'U/gprot',
    params: {
      v1: 0.24,
      pathLength: 0.7,
      epsilon: 6600,
      time: 3,
      sampleVolume: 0.02,
      conversion: 1e6,
    },
  },
  II: {
    id: 'II',
    label: 'Complex II',
    name: '琥珀酸脱氢酶',
    kit: 'E-BC-K150-M',
    wavelength: '600 nm',
    unit: 'U/gprot',
    params: {
      totalVolume: 0.21,
      sampleVolume: 0.02,
      epsilon: 21.8,
      time: 3,
      conversion: 1000,
    },
  },
  IV: {
    id: 'IV',
    label: 'Complex IV',
    name: '细胞色素 c 氧化酶',
    kit: 'E-BC-K152-M',
    wavelength: '550 nm',
    unit: 'U/gprot',
    params: {
      v1: 0.16,
      sampleVolume: 0.02,
      epsilon: 0.0191,
      pathLength: 0.5,
      time: 1,
    },
  },
};

export function emptyBcaConfig() {
  const concentrations = [0, 125, 250, 500, 750, 1000, 1500, 2000];
  return Array.from({ length: 8 }, (_, index) => ({
    id: `std-${index + 1}`,
    name: `标准品 ${index + 1}`,
    concentration: concentrations[index],
    replicateCount: 2,
    wells: [],
  }));
}

export function bcaConcentrationToCpr(value) {
  const concentration = numeric(value);
  return concentration === null ? null : concentration / 1000;
}

export function normalizeReplicateCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : 1;
}

function isRowLabel(value) {
  return typeof value === 'string' && /^[A-H]$/i.test(value.trim());
}

function numeric(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function headerColumnMap(row) {
  const map = new Map();
  row.forEach((value, index) => {
    const n = numeric(value);
    if (n !== null && Number.isInteger(n) && n >= 1 && n <= 12) map.set(n, index);
  });
  return map;
}

export function parsePlateMatrix(matrix) {
  const headerIndex = matrix.findIndex((row) => {
    const map = headerColumnMap(row);
    return map.size >= 8 && map.has(1) && map.has(12);
  });
  if (headerIndex < 0) throw new Error('没有识别到 1–12 列的酶标板矩阵。');

  const columnMap = headerColumnMap(matrix[headerIndex]);
  const rows = {};
  for (let i = headerIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i] || [];
    const label = isRowLabel(row[1]) ? row[1].trim().toUpperCase() : null;
    if (!label) continue;
    const next = matrix[i + 1] || [];
    const wells = {};
    for (let col = 1; col <= 12; col += 1) {
      const sourceIndex = columnMap.get(col);
      if (sourceIndex === undefined) continue;
      wells[col] = {
        coordinate: `${label}${col}`,
        read1: numeric(row[sourceIndex]),
        read2: numeric(next[sourceIndex]),
      };
    }
    rows[label] = wells;
  }
  if (Object.keys(rows).length < 2) throw new Error('酶标板矩阵缺少 A–H 行数据。');

  return { headerIndex, columnMap, rows };
}

export function parseWorkbook(workbook, xlsx) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  return parsePlateMatrix(matrix);
}

export function parsePastedPlate(text) {
  const source = String(text || '').replace(/^\uFEFF/, '').trimEnd();
  if (!source) throw new Error('请先粘贴酶标板表格内容。');
  const delimiter = source.includes('\t') ? '\t' : ',';
  const matrix = source.split(/\r?\n/).map((line) => line.split(delimiter).map((value) => value.trim()));
  return parsePlateMatrix(matrix);
}

export function getWell(plate, coordinate) {
  const match = /^([A-H])(\d{1,2})$/i.exec(String(coordinate).trim());
  if (!match) return null;
  return plate.rows[match[1].toUpperCase()]?.[Number(match[2])] || null;
}

export function delta(well) {
  if (!well || well.read1 === null || well.read2 === null) return null;
  return well.read1 - well.read2;
}

export function mean(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

export function fitLinear(points) {
  const clean = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (clean.length < 2) return null;
  const xMean = mean(clean.map((point) => point.x));
  const yMean = mean(clean.map((point) => point.y));
  const numerator = clean.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0);
  const denominator = clean.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0);
  if (!denominator) return null;
  const slope = numerator / denominator;
  const intercept = yMean - slope * xMean;
  const ssTot = clean.reduce((sum, point) => sum + (point.y - yMean) ** 2, 0);
  const ssRes = clean.reduce((sum, point) => sum + (point.y - (slope * point.x + intercept)) ** 2, 0);
  return { slope, intercept, r2: ssTot ? 1 - ssRes / ssTot : 1, count: clean.length };
}

export function buildBcaCurve(plate, configuredPoints) {
  const standardPoints = [];
  for (const point of configuredPoints) {
    const concentration = numeric(point.concentration);
    const wells = (point.wells || []).map((coordinate) => getWell(plate, coordinate)).filter(Boolean);
    const od = mean(wells.map((well) => well.read1));
    if (concentration !== null && od !== null) {
      standardPoints.push({ label: point.name, concentration, od, wells: wells.map((well) => well.coordinate) });
    }
  }
  const regression = fitLinear(standardPoints.map((point) => ({ x: point.concentration, y: point.od })));
  return { standardPoints, regression };
}

export function estimateConcentration(od, regression) {
  if (!Number.isFinite(od) || !regression || !regression.slope) return null;
  return (od - regression.intercept) / regression.slope;
}

export function calculateActivity({ complexId, sample, parameters, cpr, dilution = 1 }) {
  const protein = numeric(cpr);
  const f = numeric(dilution);
  if (!sample || protein === null || f === null || protein <= 0 || f <= 0) return null;
  if (complexId === 'I') {
    const controlDelta = numeric(sample.controlDelta);
    const sampleDelta = numeric(sample.sampleDelta);
    if (controlDelta === null || sampleDelta === null) return null;
    return ((controlDelta - sampleDelta) * parameters.v1 * f * parameters.conversion)
      / (parameters.epsilon * parameters.pathLength * parameters.time * parameters.sampleVolume * protein);
  }
  if (complexId === 'II') {
    const sampleDelta = numeric(sample.sampleDelta);
    const blankDelta = numeric(sample.blankDelta);
    if (sampleDelta === null || blankDelta === null) return null;
    return ((sampleDelta - blankDelta) * parameters.totalVolume * f * parameters.conversion)
      / (parameters.sampleVolume * parameters.epsilon * parameters.time * protein);
  }
  if (complexId === 'IV') {
    const sampleDelta = numeric(sample.sampleDelta);
    const blankDelta = numeric(sample.blankDelta);
    if (sampleDelta === null || blankDelta === null) return null;
    return ((sampleDelta - blankDelta) * parameters.v1 * f)
      / (parameters.sampleVolume * parameters.epsilon * parameters.pathLength * parameters.time * protein);
  }
  throw new Error(`未知 Complex: ${complexId}`);
}

export function formatNumber(value, digits = 3) {
  return Number.isFinite(value) ? Number(value).toLocaleString('zh-CN', { maximumFractionDigits: digits }) : '—';
}
