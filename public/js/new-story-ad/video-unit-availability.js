(() => {
  function unique(values = []) {
    return [...new Set(values.filter(value => value !== null && value !== undefined && String(value).trim() !== ''))];
  }

  function unitMembers(unit = {}) {
    if (Array.isArray(unit.shots) && unit.shots.length) {
      return unique(unit.shots.map(Number).filter(value => Number.isInteger(value) && value > 0));
    }
    return unique((unit.member_indexes || []).map(value => Number(value) + 1).filter(value => Number.isInteger(value) && value > 0));
  }

  function blockerScope(blocker = {}) {
    const details = blocker.details && typeof blocker.details === 'object' && !Array.isArray(blocker.details) ? blocker.details : {};
    const unitIds = unique([blocker.unit_id, details.unit_id].map(value => String(value || '').trim()));
    const shots = unique([
      ...(Array.isArray(blocker.shots) ? blocker.shots : []),
      ...(Array.isArray(details.shots) ? details.shots : []),
    ].map(Number).filter(value => Number.isInteger(value) && value > 0));
    return { scoped: blocker.scope === 'unit' || unitIds.length > 0 || shots.length > 0, unitIds, shots };
  }

  function blockerTargetsUnit(blocker = {}, unit = {}) {
    const scope = blockerScope(blocker);
    if (!scope.scoped) return false;
    if (scope.unitIds.includes(String(unit.id || ''))) return true;
    const members = new Set(unitMembers(unit));
    return scope.shots.some(shot => members.has(shot));
  }

  /** 全局 blocker 暂停全部付费单元；带 unit/shot 范围的 blocker 只禁用命中的单元。 */
  function selectionAvailability(preflight = {}) {
    const units = Array.isArray(preflight.units) ? preflight.units : [];
    const blockers = Array.isArray(preflight.blockers) ? preflight.blockers : [];
    const globalBlockers = blockers.filter(blocker => !blockerScope(blocker).scoped);
    const rows = units.map(unit => {
      const scopedBlockers = blockers.filter(blocker => blockerScope(blocker).scoped && blockerTargetsUnit(blocker, unit));
      const unitBlockers = unit.paid === false ? [] : [...globalBlockers, ...scopedBlockers];
      return { id: String(unit.id || ''), paid: unit.paid !== false, disabled: unitBlockers.length > 0, blockers: unitBlockers };
    });
    return {
      units: rows,
      selectablePaidUnits: rows.filter(row => row.paid && !row.disabled).length,
      selectableZeroCostUnits: rows.filter(row => !row.paid && !row.disabled).length,
      blockedPaidUnits: rows.filter(row => row.paid && row.disabled).length,
      selectableUnitCount: rows.filter(row => !row.disabled).length,
      globalBlockerCount: globalBlockers.length,
    };
  }

  const api = { blockerScope, blockerTargetsUnit, selectionAvailability };
  if (typeof window !== 'undefined') window.NewStoryAdVideoUnitAvailability = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
