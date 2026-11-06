import React, { useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import * as XLSX from 'xlsx';
import {
  COMPLEXES,
  activityReferenceDelta,
  bcaConcentrationToCpr,
  buildBcaCurve,
  calculateActivity,
  delta,
  emptyBcaConfig,
  estimateConcentration,
  formatNumber,
  getWell,
  mean,
  normalizeReplicateCount,
  parsePastedPlate,
  parseWorkbook,
} from './logic.js';

function readWorkbook(file) {
  return file.arrayBuffer().then((buffer) => XLSX.read(buffer, { type: 'array' }));
}

function UploadBox({ title, hint, onFile, onText, fileName }) {
  const [showPaste, setShowPaste] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const onDrop = (accepted, rejected) => {
    if (accepted[0]) onFile(accepted[0]);
    if (rejected.length) onFile(null, '请选择 .xlsx 或 .xls 文件。');
  };
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
  });
  return (
    <>
      <div {...getRootProps()} className={`upload-box ${isDragActive ? 'is-dragging' : ''}`}>
      <input {...getInputProps()} />
      <div className="upload-icon">↑</div>
      <div>
        <div className="upload-title">{title}</div>
        <div className="upload-hint">{isDragActive ? '松开鼠标即可导入' : hint}</div>
        {fileName && <div className="file-chip">{fileName}</div>}
      </div>
      <div className="upload-actions"><button type="button" className="file-button">选择文件</button><button type="button" className="ghost-button" onClick={(event) => { event.stopPropagation(); setShowPaste((current) => !current); }}>{showPaste ? '关闭粘贴' : '粘贴表格'}</button></div>
      </div>
      {showPaste && <div className="paste-box" onClick={(event) => event.stopPropagation()}><textarea value={pasteValue} onChange={(event) => setPasteValue(event.target.value)} placeholder="从 Excel 复制带制表符的酶标板内容到这里" /><button type="button" onClick={() => onText?.(pasteValue)}>解析粘贴内容</button></div>}
    </>
  );
}

function Step({ index, title, detail, active, done }) {
  return (
    <div className={`step ${active ? 'active' : ''} ${done ? 'done' : ''}`}>
      <div className="step-number">{done ? '✓' : index}</div>
      <div><div className="step-title">{title}</div><div className="step-detail">{detail}</div></div>
    </div>
  );
}

function Field({ label, value, onChange, suffix, type = 'number', step = 'any' }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-wrap">
        <input type={type} step={step} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
        {suffix && <em>{suffix}</em>}
      </div>
    </label>
  );
}

function PlatePreview({ plate, selected = [], onSelect, selectionRole = 'selected', markerByCoordinate = {}, markerLabels = {} }) {
  if (!plate) return <div className="plate-empty">导入后显示 96 孔板数据。</div>;
  const selectedSet = new Set(selected);
  return (
    <div className="plate-wrap">
      <div className="plate-corner" />
      {Array.from({ length: 12 }, (_, index) => <div className="plate-head" key={index}>{index + 1}</div>)}
      {Array.from({ length: 8 }, (_, rowIndex) => {
        const row = String.fromCharCode(65 + rowIndex);
        return <React.Fragment key={row}>
          <div className="plate-row-head">{row}</div>
          {Array.from({ length: 12 }, (_, colIndex) => {
            const well = plate.rows[row]?.[colIndex + 1];
            const coord = `${row}${colIndex + 1}`;
            const value = well?.read1;
            const role = selectedSet.has(coord) ? selectionRole : markerByCoordinate[coord];
            const markerLabel = markerLabels[coord];
            return (
              <button
                key={coord}
                type="button"
                title={`${coord} | Read 1 ${formatNumber(value, 4)} | Read 2 ${formatNumber(well?.read2, 4)}${markerLabel ? ` | ${markerLabel}` : ''}`}
                className={`plate-cell ${selectedSet.has(coord) ? 'selected' : ''} ${role ? `role-${role}` : ''}`}
                onClick={() => onSelect?.(coord)}
              >
                {value === null || value === undefined ? '—' : Number(value).toFixed(3)}
              </button>
            );
          })}
        </React.Fragment>;
      })}
    </div>
  );
}

function PlateLegend({ items }) {
  return <div className="plate-legend">{items.map((item) => <span key={item.label}><i className={`legend-swatch ${item.className}`} />{item.label}</span>)}</div>;
}

function BcaSection({ bca, onFile, onText, onConfig, onSelectSample, onSelectStandard, onActiveStandard, onAddStandard, onRemoveStandard, onMoveStandard, onExport }) {
  const curve = bca.plate ? buildBcaCurve(bca.plate, bca.config) : { standardPoints: [], regression: null };
  const activeStandard = bca.config.find((point) => point.id === bca.activeStandardId) || bca.config[0];
  const selectedStandardWells = activeStandard?.wells || [];
  const otherStandardMarkers = Object.fromEntries(bca.config.flatMap((point) => point.id === activeStandard?.id ? [] : point.wells.map((coordinate) => [coordinate, 'standard-other'])));
  const allStandardMarkers = Object.fromEntries(bca.config.flatMap((point) => point.wells.map((coordinate) => [coordinate, 'standard-other'])));
  const standardMarkerLabels = Object.fromEntries(bca.config.flatMap((point) => point.wells.map((coordinate) => [coordinate, `${point.name}（标准品）`])));
  const curveData = curve.regression
    ? Array.from({ length: 20 }, (_, index) => {
      const max = Math.max(...curve.standardPoints.map((point) => point.concentration));
      const x = (max * index) / 19;
      return { x, y: curve.regression.slope * x + curve.regression.intercept };
    })
    : [];
  const standardPointData = curve.standardPoints.map((point) => ({ x: point.concentration, y: point.od, label: point.label }));
  return (
    <section className="card" id="bca">
      <div className="section-heading">
        <div><span className="eyebrow">01 / BCA 定量</span><h2>先把蛋白浓度算准</h2><p>导入酶标仪导出的 BCA 表格，系统识别标准孔、拟合标准曲线并计算样品蛋白浓度。</p></div>
        <div className="status-pill"><span className={bca.plate ? 'status-dot ok' : 'status-dot'} />{bca.plate ? '已读取板上数据' : '等待导入'}</div>
      </div>
      <UploadBox title="拖入 BCA 结果表格" hint="支持 .xlsx / .xls，也可以粘贴 Excel 表格" onFile={onFile} onText={onText} fileName={bca.fileName} />
      {bca.error && <div className="alert error">{bca.error}</div>}
      {bca.plate && (
        <>
          <div className="subsection-title"><span>标准品配置</span><small>标准品名称、浓度、上样顺序和复孔数均可自行配置。</small></div>
          <div className="standard-config-list">
            {bca.config.map((point, index) => (
              <div className={`standard-config-row ${point.id === bca.activeStandardId ? 'active' : ''}`} key={point.id}>
                <button type="button" className="standard-index" onClick={() => onActiveStandard(point.id)}>{index + 1}</button>
                <label className="mini-field"><span>名称</span><input value={point.name} onChange={(event) => onConfig(point.id, 'name', event.target.value)} /></label>
                <label className="mini-field"><span>浓度</span><div className="mini-input-wrap"><input type="number" step="any" value={point.concentration} onChange={(event) => onConfig(point.id, 'concentration', event.target.value)} /><em>μg/mL</em></div></label>
                <label className="mini-field"><span>复孔数</span><input type="number" min="1" step="1" value={point.replicateCount} onChange={(event) => onConfig(point.id, 'replicateCount', event.target.value)} /></label>
                <button type="button" className="standard-well-button" onClick={() => onActiveStandard(point.id)}>{point.wells.length ? `已选 ${point.wells.length} 孔` : '选择孔位'}</button>
                <div className="sort-buttons"><button type="button" disabled={index === 0} onClick={() => onMoveStandard(point.id, -1)}>↑</button><button type="button" disabled={index === bca.config.length - 1} onClick={() => onMoveStandard(point.id, 1)}>↓</button></div>
                <button type="button" className="remove-button" disabled={bca.config.length <= 2} onClick={() => onRemoveStandard(point.id)}>×</button>
              </div>
            ))}
            <button type="button" className="add-standard" onClick={onAddStandard}>＋ 添加标准品</button>
          </div>
          <div className="standard-editor">
            <div><b>当前配置：{activeStandard?.name || '标准品'}</b><small>在下方 96 孔板上逐孔点选复孔；当前已选 {selectedStandardWells.length} 孔。</small></div>
            <span className="muted">上样顺序 {Math.max(1, bca.config.findIndex((point) => point.id === activeStandard?.id) + 1)}</span>
          </div>
          <div className="panel standard-plate-panel"><PlatePreview plate={bca.plate} selected={selectedStandardWells} selectionRole="standard-current" markerByCoordinate={otherStandardMarkers} markerLabels={standardMarkerLabels} onSelect={onSelectStandard} /><PlateLegend items={[{ label: '当前标准品', className: 'standard-current' }, { label: '其他标准品', className: 'standard-other' }]} /></div>
          <div className="bca-grid">
            <div className="panel">
              <div className="panel-header"><h3>标准曲线</h3><span className="muted">{curve.regression ? `R² ${curve.regression.r2.toFixed(4)}` : '至少配置 2 个有效标准点'}</span></div>
              <div className="chart-box">
                {curve.regression ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 12, right: 20, bottom: 18, left: 6 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e7edf4" />
                      <XAxis type="number" dataKey="x" name="浓度" unit=" μg/mL" tick={{ fill: '#76849a', fontSize: 11 }} />
                      <YAxis type="number" dataKey="y" name="OD562" tick={{ fill: '#76849a', fontSize: 11 }} />
                      <Tooltip formatter={(value) => Number(value).toFixed(4)} />
                      <Scatter data={standardPointData} fill="#14a9a1" />
                      <Line data={curveData} type="monotone" dataKey="y" stroke="#14a9a1" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </ScatterChart>
                  </ResponsiveContainer>
                ) : <div className="chart-placeholder"><span>∿</span><p>输入标准浓度后显示回归曲线</p></div>}
              </div>
              {curve.regression && <div className="formula-chip">y = {curve.regression.slope.toFixed(4)}x {curve.regression.intercept >= 0 ? '+' : '−'} {Math.abs(curve.regression.intercept).toFixed(4)}</div>}
            </div>
            <div className="panel">
              <div className="panel-header"><h3>标准孔概览</h3><span className="muted">均值 OD562</span></div>
              <div className="standard-table">
                {bca.config.map((point) => {
                  const wells = point.wells.map((coordinate) => getWell(bca.plate, coordinate)).filter(Boolean);
                  return <div className="standard-row" key={point.id}><b>{point.name}</b><span>{wells.map((well) => well.coordinate).join(', ') || '—'}</span><strong>{formatNumber(mean(wells.map((well) => well.read1)), 4)}</strong></div>;
                })}
              </div>
              <div className="mini-note">标准品浓度以 μg/mL 输入；活性计算中的 Cpr 会自动换算为 gprot/L。未被标为标准品的孔可在下方作为样品使用。</div>
            </div>
          </div>
          <div className="subsection-title"><span>样品蛋白浓度</span><small>点击板位可选择样品，浓度由标准曲线反算。</small></div>
          <div className="sample-concentration-grid">
            <div className="panel plate-panel"><PlatePreview plate={bca.plate} selected={bca.selectedSamples} selectionRole="sample" markerByCoordinate={allStandardMarkers} markerLabels={standardMarkerLabels} onSelect={onSelectSample} /><PlateLegend items={[{ label: '已选样品', className: 'sample' }, { label: '标准品孔', className: 'standard-other' }]} /></div>
            <div className="panel sample-list">
              <div className="panel-header"><h3>已选样品</h3><div className="panel-header-actions"><span className="muted">{bca.selectedSamples.length} 个</span><button type="button" className="export-button" disabled={!bca.selectedSamples.length || !curve.regression?.slope} onClick={onExport}>导出 XLSX</button></div></div>
              {bca.selectedSamples.length === 0 ? <div className="empty-list">从左侧板图点选样品孔。</div> : bca.selectedSamples.map((coordinate) => {
                const well = bca.plate.rows[coordinate[0]]?.[Number(coordinate.slice(1))];
                const concentration = estimateConcentration(well?.read1, curve.regression);
                return <div className="sample-row" key={coordinate}><div><b>{coordinate}</b><span>OD {formatNumber(well?.read1, 4)} · Cpr {formatNumber(bcaConcentrationToCpr(concentration), 4)} gprot/L</span></div><strong>{formatNumber(concentration, 2)} <em>μg/mL</em></strong></div>;
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function ParameterPanel({ complex, parameters, onChange }) {
  const fields = complex.id === 'I'
    ? [['v1', '反应总体积', 'mL'], ['pathLength', '光径', 'cm'], ['epsilon', '摩尔消光系数', 'L/(mol·cm)'], ['time', '反应时间', 'min'], ['sampleVolume', '加样体积', 'mL'], ['conversion', '换算因子', 'μmol/mol']]
    : complex.id === 'II'
      ? [['totalVolume', '反应总体积', 'mL'], ['sampleVolume', '加样体积', 'mL'], ['epsilon', '摩尔吸光系数', ''], ['time', '反应时间', 'min'], ['conversion', '换算因子', 'μmol/mmol']]
      : [['v1', '反应总体积', 'mL'], ['sampleVolume', '加样体积', 'mL'], ['epsilon', '摩尔吸光系数', 'L/(μmol·cm)'], ['pathLength', '光径', 'cm'], ['time', '反应时间', 'min']];
  return <details className="parameters"><summary>查看 / 修改协议参数</summary><div className="parameter-grid">{fields.map(([key, label, suffix]) => <Field key={key} label={label} value={parameters[key]} onChange={(value) => onChange(key, value)} suffix={suffix} />)}</div></details>;
}

function ActivitySection({ bca }) {
  const [selectedComplex, setSelectedComplex] = useState('I');
  const [parameters, setParameters] = useState(COMPLEXES.I.params);
  const [odPlate, setOdPlate] = useState(null);
  const [odFileName, setOdFileName] = useState('');
  const [odError, setOdError] = useState('');
  const [mapping, setMapping] = useState({ control: [], blank: [], sample: [], controlBySample: {} });
  const [mappingMode, setMappingMode] = useState('sample');
  const [rowInputs, setRowInputs] = useState({});
  const complex = COMPLEXES[selectedComplex];
  const linkedCurve = bca.plate ? buildBcaCurve(bca.plate, bca.config) : null;
  const linkedBcaConcentrations = useMemo(() => Object.fromEntries((bca.selectedSamples || []).map((coordinate) => [coordinate, bcaConcentrationToCpr(estimateConcentration(getWell(bca.plate, coordinate)?.read1, linkedCurve?.regression))])), [bca.plate, bca.selectedSamples, linkedCurve]);
  const activeKey = mappingMode === 'sample' ? 'sample' : selectedComplex === 'I' ? 'control' : 'blank';
  const activeLabel = mappingMode === 'sample' ? '测定孔' : selectedComplex === 'I' ? '对照孔' : '空白孔';
  const handleComplexChange = (id) => {
    setSelectedComplex(id);
    setParameters(COMPLEXES[id].params);
    setMappingMode('sample');
  };
  const handleOdFile = async (file, error) => {
    if (error) { setOdError(error); return; }
    if (!file) return;
    try {
      const workbook = await readWorkbook(file);
      setOdPlate(parseWorkbook(workbook, XLSX));
      setOdFileName(file.name);
      setMapping({ control: [], blank: [], sample: [], controlBySample: {} });
      setRowInputs({});
      setOdError('');
    } catch (caught) { setOdError(caught.message || '无法解析该 OD 文件。'); }
  };
  const handleOdFileText = (text) => {
    try {
      setOdPlate(parsePastedPlate(text));
      setOdFileName('粘贴的 OD 表格');
      setMapping({ control: [], blank: [], sample: [], controlBySample: {} });
      setRowInputs({});
      setOdError('');
    } catch (caught) { setOdError(caught.message || '无法解析粘贴的 OD 表格。'); }
  };
  const toggleMapping = (coordinate) => setMapping((current) => {
    const currentValues = current[activeKey] || [];
    const selected = currentValues.includes(coordinate);
    const nextValues = selected ? currentValues.filter((item) => item !== coordinate) : [...currentValues, coordinate];
    const controlBySample = { ...(current.controlBySample || {}) };
    if (activeKey === 'sample' && selected) delete controlBySample[coordinate];
    if (activeKey === 'control' && selected) {
      Object.entries(controlBySample).forEach(([sampleCoordinate, controlCoordinate]) => {
        if (controlCoordinate === coordinate) delete controlBySample[sampleCoordinate];
      });
    }
    return { ...current, [activeKey]: nextValues, controlBySample };
  });
  const updateControlPair = (sampleCoordinate, controlCoordinate) => setMapping((current) => {
    const controlBySample = { ...(current.controlBySample || {}) };
    if (controlCoordinate) controlBySample[sampleCoordinate] = controlCoordinate;
    else delete controlBySample[sampleCoordinate];
    return { ...current, controlBySample };
  });
  const updateRowInput = (coordinate, key, value) => setRowInputs((current) => {
    const base = current[coordinate] || { name: coordinate, cpr: linkedBcaConcentrations[coordinate] ?? '', dilution: '1' };
    return { ...current, [coordinate]: { ...base, [key]: value } };
  });
  const activityRows = useMemo(() => {
    return mapping.sample.map((coordinate) => {
      const input = rowInputs[coordinate] || { name: coordinate, cpr: linkedBcaConcentrations[coordinate] ?? '', dilution: '1' };
      const controlCoordinate = mapping.controlBySample?.[coordinate] || null;
      const referenceDelta = activityReferenceDelta({
        complexId: selectedComplex,
        plate: odPlate,
        sampleCoordinate: coordinate,
        controlBySample: mapping.controlBySample,
        referenceCoordinates: mapping.blank,
      });
      const result = calculateActivity({
        complexId: selectedComplex,
        sample: { controlDelta: selectedComplex === 'I' ? referenceDelta : null, blankDelta: selectedComplex === 'I' ? null : referenceDelta, sampleDelta: delta(getWell(odPlate, coordinate)) },
        parameters,
        cpr: input.cpr,
        dilution: input.dilution,
      });
      return { coordinate, controlCoordinate, input, sampleDelta: delta(getWell(odPlate, coordinate)), referenceDelta, result };
    });
  }, [linkedBcaConcentrations, mapping, odPlate, parameters, rowInputs, selectedComplex]);
  const validResults = activityRows.filter((row) => Number.isFinite(row.result));
  const blankDelta = odPlate && selectedComplex !== 'I'
    ? activityReferenceDelta({ complexId: selectedComplex, plate: odPlate, referenceCoordinates: mapping.blank })
    : null;
  const pairedCount = mapping.sample.filter((coordinate) => mapping.controlBySample?.[coordinate]).length;
  const mappingMarkers = Object.fromEntries([
    ...mapping.blank.map((coordinate) => [coordinate, 'activity-blank']),
    ...mapping.control.map((coordinate) => [coordinate, 'activity-control']),
    ...mapping.sample.map((coordinate) => [coordinate, 'activity-sample']),
  ]);
  const mappingLabels = Object.fromEntries([
    ...mapping.blank.map((coordinate) => [coordinate, '空白孔']),
    ...mapping.control.map((coordinate) => [coordinate, '对照孔']),
    ...mapping.sample.map((coordinate) => [coordinate, '测定孔']),
  ]);
  return (
    <section className="card" id="activity">
      <div className="section-heading">
        <div><span className="eyebrow">02 / 活性计算</span><h2>选择 Complex，批量计算 OD 结果</h2><p>先批量配置测定孔和对照/空白孔；Complex I 再为每个测定孔指定唯一对照孔，系统逐行计算。</p></div>
        <div className="status-pill"><span className={`status-dot ${odPlate ? 'ok' : ''}`} />{odPlate ? '已读取 OD 数据' : '等待导入'}</div>
      </div>
      <div className="complex-tabs">{Object.values(COMPLEXES).map((item) => <button type="button" key={item.id} className={selectedComplex === item.id ? 'active' : ''} onClick={() => handleComplexChange(item.id)}><span>{item.label}</span><small>{item.name}</small></button>)}</div>
      <div className="protocol-strip"><div><span>试剂盒</span><b>{complex.kit}</b></div><div><span>检测波长</span><b>{complex.wavelength}</b></div><div><span>输出单位</span><b>{complex.unit}</b></div><div className="formula-text"><span>公式</span><b>{selectedComplex === 'I' ? 'ΔA 对照 − ΔA 测定' : 'ΔA 测定 − ΔA 空白'}</b></div></div>
      <UploadBox title="拖入 OD 结果表格" hint={`当前选择 ${complex.label}，支持 .xlsx / .xls，也可以粘贴`} onFile={handleOdFile} onText={handleOdFileText} fileName={odFileName} />
      {odError && <div className="alert error">{odError}</div>}
      {odPlate && (
        <>
          <div className="activity-layout">
            <div className="panel plate-panel"><div className="panel-header"><h3>OD 板位批量选择</h3><span className="muted">当前：{activeLabel}</span></div><PlatePreview plate={odPlate} selected={mapping[activeKey]} selectionRole={`activity-${activeKey}`} markerByCoordinate={mappingMarkers} markerLabels={mappingLabels} onSelect={toggleMapping} /><div className="read-legend"><span><i className="legend-read1" />Read 1：反应开始</span><span><i className="legend-read2" />Read 2：反应结束</span></div><PlateLegend items={selectedComplex === 'I' ? [{ label: '测定孔', className: 'activity-sample' }, { label: '对照孔', className: 'activity-control' }] : [{ label: '测定孔', className: 'activity-sample' }, { label: '空白孔', className: 'activity-blank' }]} /></div>
            <div className="panel calc-panel">
              <div className="panel-header"><h3>板位配置</h3><span className="muted">可多选</span></div>
              <div className="mapping-mode"><span>选择模式</span><button type="button" className={mappingMode === 'sample' ? 'active' : ''} onClick={() => setMappingMode('sample')}>测定孔 ({mapping.sample.length})</button><button type="button" className={mappingMode !== 'sample' ? 'active' : ''} onClick={() => setMappingMode(selectedComplex === 'I' ? 'control' : 'blank')}>{selectedComplex === 'I' ? `对照孔 (${mapping.control.length})` : `空白孔 (${mapping.blank.length})`}</button></div>
              <div className="selection-summary">
                <div><span>测定孔</span><b>{mapping.sample.join(', ') || '未选择'}</b></div>
                {selectedComplex === 'I' ? <>
                  <div><span>已选对照孔</span><b>{mapping.control.join(', ') || '未选择'}</b></div>
                  <div><span>一一匹配</span><b>{pairedCount} / {mapping.sample.length} 个样品</b></div>
                </> : <div><span>空白孔 ΔA 均值</span><b>{formatNumber(blankDelta, 4)}</b></div>}
              </div>
              <ParameterPanel complex={complex} parameters={parameters} onChange={(key, value) => setParameters((current) => ({ ...current, [key]: Number(value) }))} />
            </div>
          </div>
          <div className="batch-panel">
            <div className="panel-header"><h3>批量计算明细</h3><span className="muted">已选择 {mapping.sample.length} 个测定孔，已计算 {validResults.length} 个</span></div>
            {selectedComplex === 'I' && activityRows.length > 0 && <div className="pairing-note">Complex I：请在每行选择对应的对照孔；同一对照孔不能重复匹配多个样品。</div>}
            {activityRows.length === 0 ? <div className="empty-list">切换到“测定孔”模式，在左侧板图中多选样品孔。</div> : <div className="batch-table-wrap"><table className="batch-table"><thead><tr><th>#</th><th>测定孔</th>{selectedComplex === 'I' && <th>对应对照孔</th>}<th>样品名称</th><th>Cpr（gprot/L）</th><th>稀释倍数 f</th>{selectedComplex === 'I' && <th>ΔA对</th>}<th>ΔA测</th><th>结果（{complex.unit}）</th></tr></thead><tbody>{activityRows.map((row, index) => <tr key={row.coordinate}><td>{index + 1}</td><td><b>{row.coordinate}</b></td>{selectedComplex === 'I' && <td><select className="table-select" value={row.controlCoordinate || ''} onChange={(event) => updateControlPair(row.coordinate, event.target.value)}><option value="">选择对照孔</option>{mapping.control.map((coordinate) => <option key={coordinate} value={coordinate} disabled={Object.entries(mapping.controlBySample || {}).some(([sampleCoordinate, controlCoordinate]) => sampleCoordinate !== row.coordinate && controlCoordinate === coordinate)}>{coordinate}</option>)}</select></td>}<td><input className="table-input" value={row.input.name} onChange={(event) => updateRowInput(row.coordinate, 'name', event.target.value)} /></td><td><input className="table-input number" type="number" step="any" value={row.input.cpr} onChange={(event) => updateRowInput(row.coordinate, 'cpr', event.target.value)} /></td><td><input className="table-input number" type="number" step="any" value={row.input.dilution} onChange={(event) => updateRowInput(row.coordinate, 'dilution', event.target.value)} /></td>{selectedComplex === 'I' && <td className="mono-cell">{formatNumber(row.referenceDelta, 4)}</td>}<td className="mono-cell">{formatNumber(row.sampleDelta, 4)}</td><td className="result-cell">{formatNumber(row.result, 2)}</td></tr>)}</tbody></table></div>}
          </div>
          <div className="result-banner"><div><span>批量计算结果</span><strong>{validResults.length} / {activityRows.length} <em>个有效结果</em></strong><small>{selectedComplex === 'I' ? `${complex.label} · 已匹配 ${pairedCount} / ${mapping.sample.length} 个对照孔` : `${complex.label} · 空白孔 ΔA均值 ${formatNumber(blankDelta, 4)}`}</small></div><div className="result-equation">{selectedComplex === 'I' ? '((ΔA对 − ΔA测) × V1 × f × 10⁶) / (6600 × 0.7 × T × V2 × Cpr)' : selectedComplex === 'II' ? '((ΔA测 − ΔA空) × V总 × f × 1000) / (V样 × ε × T × Cpr)' : '((ΔA测 − ΔA空) × V1 × f) / (V2 × ε × d × T × Cpr)'}</div></div>
        </>
      )}
    </section>
  );
}

function App() {
  const [bca, setBca] = useState({
    plate: null,
    fileName: '',
    error: '',
    config: emptyBcaConfig(),
    activeStandardId: 'std-1',
    selectedSamples: [],
  });
  const [toast, setToast] = useState('');
  const handleBcaFile = async (file, error) => {
    if (error) { setBca((current) => ({ ...current, error })); return; }
    if (!file) return;
    try {
      const workbook = await readWorkbook(file);
      const plate = parseWorkbook(workbook, XLSX);
      setBca((current) => ({ ...current, plate, fileName: file.name, error: '', config: emptyBcaConfig(), activeStandardId: 'std-1', selectedSamples: [] }));
      setToast('BCA 表格已读取');
      window.setTimeout(() => setToast(''), 2200);
    } catch (caught) { setBca((current) => ({ ...current, error: caught.message || '无法解析该 BCA 文件。' })); }
  };
  const handleBcaText = (text) => {
    try {
      const plate = parsePastedPlate(text);
      setBca((current) => ({ ...current, plate, fileName: '粘贴的 BCA 表格', error: '', config: emptyBcaConfig(), activeStandardId: 'std-1', selectedSamples: [] }));
      setToast('BCA 表格已读取');
      window.setTimeout(() => setToast(''), 2200);
    } catch (caught) { setBca((current) => ({ ...current, error: caught.message || '无法解析粘贴的 BCA 表格。' })); }
  };
  const updateBcaConfig = (id, key, value) => setBca((current) => ({
    ...current,
    config: current.config.map((point) => {
      if (point.id !== id) return point;
      if (key !== 'replicateCount') return { ...point, [key]: value };
      const replicateCount = normalizeReplicateCount(value);
      return { ...point, replicateCount, wells: point.wells.slice(0, replicateCount) };
    }),
  }));
  const toggleBcaSample = (coordinate) => setBca((current) => {
    const isStandard = current.config.some((point) => point.wells.includes(coordinate));
    if (isStandard) return current;
    return {
      ...current,
      selectedSamples: current.selectedSamples.includes(coordinate)
        ? current.selectedSamples.filter((item) => item !== coordinate)
        : [...current.selectedSamples, coordinate],
    };
  });
  const toggleBcaStandard = (coordinate) => setBca((current) => {
    const active = current.config.find((point) => point.id === current.activeStandardId);
    if (!active) return current;
    const isAssignedElsewhere = current.config.some((point) => point.id !== active.id && point.wells.includes(coordinate));
    if (isAssignedElsewhere && !active.wells.includes(coordinate)) return current;
    const isRemoving = active.wells.includes(coordinate);
    const canAdd = active.wells.length < active.replicateCount;
    if (!isRemoving && !canAdd) return current;
    const wells = isRemoving
      ? active.wells.filter((item) => item !== coordinate)
      : [...active.wells, coordinate];
    return {
      ...current,
      config: current.config.map((point) => point.id === active.id ? { ...point, wells } : point),
      selectedSamples: isRemoving
        ? current.selectedSamples
        : current.selectedSamples.filter((item) => item !== coordinate),
    };
  });
  const addBcaStandard = () => setBca((current) => {
    const nextIndex = current.config.length + 1;
    const id = `std-${Date.now()}-${nextIndex}`;
    return {
      ...current,
      config: [...current.config, { id, name: `标准品 ${nextIndex}`, concentration: '', replicateCount: 2, wells: [] }],
      activeStandardId: id,
    };
  });
  const removeBcaStandard = (id) => setBca((current) => {
    if (current.config.length <= 2) return current;
    const config = current.config.filter((point) => point.id !== id);
    return {
      ...current,
      config,
      activeStandardId: current.activeStandardId === id ? config[0].id : current.activeStandardId,
    };
  });
  const moveBcaStandard = (id, direction) => setBca((current) => {
    const index = current.config.findIndex((point) => point.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= current.config.length) return current;
    const config = [...current.config];
    [config[index], config[target]] = [config[target], config[index]];
    return { ...current, config };
  });
  const exportBcaResults = () => {
    const curve = bca.plate ? buildBcaCurve(bca.plate, bca.config) : null;
    if (!bca.plate || !bca.selectedSamples.length || !curve?.regression?.slope) {
      setToast('请先选择样品孔并完成至少两个有效标准点');
      window.setTimeout(() => setToast(''), 2200);
      return;
    }
    const sampleRows = bca.selectedSamples.map((coordinate, index) => {
      const well = getWell(bca.plate, coordinate);
      return {
        序号: index + 1,
        孔位: coordinate,
        OD562: well?.read1 ?? '',
        蛋白浓度: estimateConcentration(well?.read1, curve.regression) ?? '',
        蛋白浓度单位: 'μg/mL',
        Cpr: bcaConcentrationToCpr(estimateConcentration(well?.read1, curve.regression)) ?? '',
        Cpr单位: 'gprot/L',
      };
    });
    const standardRows = bca.config.map((point) => {
      const wells = point.wells.map((coordinate) => getWell(bca.plate, coordinate)).filter(Boolean);
      return {
        标准品: point.name,
        浓度: point.concentration,
        单位: 'μg/mL',
        复孔数: point.replicateCount,
        孔位: point.wells.join(', '),
        均值OD562: mean(wells.map((well) => well.read1)) ?? '',
      };
    });
    const curveRows = [
      { 参数: '斜率', 数值: curve.regression.slope },
      { 参数: '截距', 数值: curve.regression.intercept },
      { 参数: 'R²', 数值: curve.regression.r2 },
      { 参数: '有效标准点数', 数值: curve.regression.count },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sampleRows), '样品浓度');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(standardRows), '标准品配置');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(curveRows), '标准曲线');
    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `ComplexLab_BCA_蛋白浓度_${date}.xlsx`);
    setToast('蛋白浓度结果已导出');
    window.setTimeout(() => setToast(''), 2200);
  };
  return (
    <div className="app-shell">
      <header className="topbar"><div className="brand"><div className="brand-mark"><span /><span /><span /></div><div><div className="brand-name">Complex<span>Lab</span></div><div className="brand-subtitle">呼吸链酶活性计算</div></div></div><div className="topbar-actions"><span className="local-badge"><i />本地处理，不上传数据</span><button type="button" className="icon-button" onClick={() => document.getElementById('help').scrollIntoView({ behavior: 'smooth' })}>?</button></div></header>
      <main className="main-content">
        <section className="hero"><div><div className="hero-kicker">MITOCHONDRIAL RESPIRATORY CHAIN</div><h1>把一张酶标板，<br /><span>变成可追溯的结果。</span></h1><p>从 BCA 标准曲线到 Complex I / II / IV 活性归一化，所有计算都在当前浏览器完成，参数和公式清晰可查。</p></div><div className="hero-visual"><div className="orb orb-a" /><div className="orb orb-b" /><div className="hero-grid"><span>OD</span><span>×</span><span>U/gprot</span><span>→</span><span>Cpr</span><span>f</span></div></div></section>
        <div className="stepper"><Step index="1" title="BCA 蛋白定量" detail="标准曲线 / 样品浓度" active={!bca.plate} done={Boolean(bca.plate)} /><div className="step-line" /><Step index="2" title="Complex 活性" detail="OD 读数 / 归一化" active={Boolean(bca.plate)} /><div className="step-line" /><Step index="3" title="复核结果" detail="公式 / 参数 / 质控" /></div>
        <BcaSection
          bca={bca}
          onFile={handleBcaFile}
          onText={handleBcaText}
          onConfig={updateBcaConfig}
          onSelectSample={toggleBcaSample}
          onSelectStandard={toggleBcaStandard}
          onActiveStandard={(id) => setBca((current) => ({ ...current, activeStandardId: id }))}
          onAddStandard={addBcaStandard}
          onRemoveStandard={removeBcaStandard}
          onMoveStandard={moveBcaStandard}
          onExport={exportBcaResults}
        />
        <ActivitySection bca={bca} />
        <section className="card help-card" id="help"><div className="section-heading"><div><span className="eyebrow">03 / 使用说明</span><h2>留下一条可复核的计算链</h2><p>原始文件只负责提供 OD；标准浓度、板位映射、稀释倍数和蛋白浓度都是明确的输入。</p></div></div><div className="help-grid"><div><b>1. BCA</b><span>导入表格，配置标准品浓度、复孔和孔位，再选择样品孔。</span></div><div><b>2. OD</b><span>选择 Complex 后导入对应文件，批量选择测定孔和对照/空白孔。</span></div><div><b>3. 审核</b><span>查看公式、参数和 ΔA，确认结果处于试剂盒线性范围内后再记录或进一步分析。</span></div></div><div className="warning-note">研究用途计算辅助工具。最终结果请结合原始实验记录、试剂盒说明书和实验质量控制判断。</div></section>
      </main>
      {toast && <div className="toast">✓ {toast}</div>}
      <footer>ComplexLab · 浏览器本地运行 · 公式依据 protocol 文件夹中的 Elabscience 说明书</footer>
    </div>
  );
}

export default App;
