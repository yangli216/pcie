/**
 * MedHermes JS SDK v3.0.0
 * 全医慧助（PCIE）第三方 HIS 集成 SDK（保留 MedHermes 全局对象兼容旧接入）
 *
 * 零依赖、单文件，通过 <script> 标签或 ES Module 引入即可使用。
 * 封装全部本地 HTTP Bridge 接口 + WebSocket 事件订阅分发 + 协议拉起 + 浏览器上下文同步。
 *
 * @license MIT
 * @see https://github.com/yangli216/pcie
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MedHermes = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SDK_VERSION = '3.0.0';

  // ─── 工具函数 ───

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      if (source) {
        for (var key in source) {
          if (Object.prototype.hasOwnProperty.call(source, key)) {
            target[key] = source[key];
          }
        }
      }
    }
    return target;
  }

  var STREAM_EVENT_NAMES = {
    event: true,
    draft: true,
    'final-report': true,
    batch: true,
    'record-confirmed': true,
    'reference-request': true,
    'reference-feedback': true,
    cancelled: true
  };

  function buildEventKey(result) {
    var envelope = normalizeEventEnvelope(result);
    var event = envelope && envelope.event ? envelope.event : {};
    var payload = event.payload || {};
    return JSON.stringify({
      id: event.id || '',
      consultationId: event.consultationId || '',
      eventType: event.type || payload.resultType || '',
      requestId: event.requestId || payload.requestId || '',
      referenceStatus: payload.referenceStatus || '',
      timestamp: event.timestamp || 0
    });
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeEventPayload(payload) {
    return isPlainObject(payload) ? assign({}, payload) : {};
  }

  function normalizeConsultationEvent(event) {
    if (!isPlainObject(event)) return null;

    var payload = normalizeEventPayload(event.payload);
    var consultationId = event.consultationId || payload.consultationId || payload.consultation_id || '';
    var requestId = event.requestId || payload.requestId || '';
    var type = event.type || payload.resultType || null;
    var timestamp = event.timestamp || payload.timestamp || Date.now();

    return {
      id: event.id || [consultationId || '-', requestId || '-', type || '-', timestamp].join(':'),
      type: type,
      consultationId: consultationId,
      requestId: requestId || null,
      timestamp: timestamp,
      terminal: event.terminal !== false,
      payload: payload
    };
  }

  function normalizeEventEnvelope(result) {
    if (!isPlainObject(result)) return null;

    var event = normalizeConsultationEvent(result.event);
    var state = typeof result.state === 'string' && result.state
      ? result.state
      : (event && event.type === 'cancelled' ? 'cancelled' : event ? 'ready' : 'pending');

    return {
      state: state,
      traceId: typeof result.traceId === 'string' ? result.traceId : '',
      code: typeof result.code === 'string' ? result.code : '',
      message: typeof result.message === 'string' ? result.message : '',
      event: event
    };
  }

  function buildEventWebSocketUrl(baseUrl, lastEventId) {
    var url = String(baseUrl || 'http://127.0.0.1:8081/api').replace(/\/+$/, '');
    url = url.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
    url += '/consultation/events/ws';
    if (lastEventId) {
      url += '?after=' + encodeURIComponent(lastEventId);
    }
    return url;
  }

  function getPatientId(patient) {
    return patient && (patient.idPi || patient.patientId) || '';
  }

  function getPatientAnchorId(patient) {
    return patient && (patient.idVis || patient.visitId || patient.idPi || patient.patientId) || '';
  }

  function stringValue(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function isExactNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0 && value === value.trim();
  }

  var VOICE_OUTPATIENT_EMR_TEMPLATE_FIELDS = [
    'templateId',
    'templateName',
    'templateHtml',
    'templateDefinition',
    'targetFieldIds',
    'requestId'
  ];

  function prepareVoicePatientPayload(patient) {
    if (!patient || !Object.prototype.hasOwnProperty.call(patient, 'outpatientEmr')) {
      return patient;
    }
    if (!isExactNonEmptyString(patient.idVis)) {
      throw new Error('startVoice 动态门诊模板模式要求无首尾空白的 idVis');
    }
    var template = patient.outpatientEmr;
    if (!isStrictOutpatientEmrJsonObject(template)) {
      throw new Error('startVoice outpatientEmr 必须是严格对象');
    }
    if (typeof Object.getOwnPropertySymbols === 'function'
      && Object.getOwnPropertySymbols(template).length > 0) {
      throw new Error('startVoice outpatientEmr 不能包含 Symbol 字段');
    }
    var keys = Object.getOwnPropertyNames(template);
    if (keys.length !== VOICE_OUTPATIENT_EMR_TEMPLATE_FIELDS.length) {
      throw new Error('startVoice outpatientEmr 必须且只能包含六个文档化字段');
    }
    for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      if (VOICE_OUTPATIENT_EMR_TEMPLATE_FIELDS.indexOf(keys[keyIndex]) < 0) {
        throw new Error('startVoice outpatientEmr 包含未支持字段: ' + keys[keyIndex]);
      }
      var descriptor = Object.getOwnPropertyDescriptor(template, keys[keyIndex]);
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new Error('startVoice outpatientEmr 只能包含可枚举的普通 JSON 字段');
      }
    }
    if (!isExactNonEmptyString(template.templateId)
      || !isExactNonEmptyString(template.templateName)
      || !isExactNonEmptyString(template.requestId)
      || typeof template.templateHtml !== 'string'
      || !template.templateHtml.trim()
      || typeof template.templateDefinition !== 'string'
      || !template.templateDefinition.trim()) {
      throw new Error('startVoice outpatientEmr 模板身份或模板原文无效');
    }
    if (!Array.isArray(template.targetFieldIds) || template.targetFieldIds.length === 0) {
      throw new Error('startVoice outpatientEmr targetFieldIds 至少需要一个字段');
    }
    var uniqueTargetIds = {};
    for (var targetIndex = 0; targetIndex < template.targetFieldIds.length; targetIndex++) {
      var targetId = template.targetFieldIds[targetIndex];
      if (!isExactNonEmptyString(targetId) || uniqueTargetIds[targetId]) {
        throw new Error('startVoice outpatientEmr targetFieldIds 必须无空白且不重复');
      }
      uniqueTargetIds[targetId] = true;
    }
    return assign({}, patient, {
      outpatientEmr: {
        templateId: template.templateId,
        templateName: template.templateName,
        templateHtml: template.templateHtml,
        templateDefinition: template.templateDefinition,
        targetFieldIds: template.targetFieldIds.slice(),
        requestId: template.requestId
      }
    });
  }

  function hasNonEmptyOutpatientEmrFact(value, visited) {
    if (typeof value === 'string') return !!value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return true;
    if (!value || typeof value !== 'object') return false;
    if (visited.indexOf(value) >= 0) return false;
    visited.push(value);
    var keys;
    if (Array.isArray(value)) {
      for (var arrayIndex = 0; arrayIndex < value.length; arrayIndex++) {
        if (hasNonEmptyOutpatientEmrFact(value[arrayIndex], visited)) return true;
      }
      return false;
    }
    keys = Object.keys(value);
    for (var keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      if (hasNonEmptyOutpatientEmrFact(value[keys[keyIndex]], visited)) return true;
    }
    return false;
  }

  function isStrictOutpatientEmrJsonObject(value) {
    if (Object.prototype.toString.call(value) !== '[object Object]') return false;
    var prototype = Object.getPrototypeOf(value);
    if (prototype === null) return true;
    var constructor = Object.prototype.hasOwnProperty.call(prototype, 'constructor')
      ? prototype.constructor
      : null;
    return typeof constructor === 'function'
      && Function.prototype.toString.call(constructor) === Function.prototype.toString.call(Object);
  }

  function rejectUnsupportedOutpatientEmrJson(fieldName) {
    throw new Error(
      'analyzeOutpatientEmr ' + fieldName
      + ' 必须只包含严格 JSON 值，不能包含未定义值、非有限数值、日期、函数或循环引用'
    );
  }

  function cloneOutpatientEmrJsonValue(value, fieldName, ancestors) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (isFinite(value)) return value;
      return rejectUnsupportedOutpatientEmrJson(fieldName);
    }
    if (typeof value !== 'object') {
      return rejectUnsupportedOutpatientEmrJson(fieldName);
    }
    if (ancestors.indexOf(value) >= 0) {
      return rejectUnsupportedOutpatientEmrJson(fieldName);
    }

    var isArray = Array.isArray(value);
    if (!isArray && !isStrictOutpatientEmrJsonObject(value)) {
      return rejectUnsupportedOutpatientEmrJson(fieldName);
    }
    if (typeof Object.getOwnPropertySymbols === 'function'
      && Object.getOwnPropertySymbols(value).length > 0) {
      return rejectUnsupportedOutpatientEmrJson(fieldName);
    }

    ancestors.push(value);
    var cloned;
    if (isArray) {
      var arrayPropertyNames = Object.getOwnPropertyNames(value);
      if (arrayPropertyNames.length !== value.length + 1) {
        ancestors.pop();
        return rejectUnsupportedOutpatientEmrJson(fieldName);
      }
      cloned = [];
      for (var arrayIndex = 0; arrayIndex < value.length; arrayIndex++) {
        var arrayDescriptor = Object.getOwnPropertyDescriptor(value, String(arrayIndex));
        if (!arrayDescriptor || !Object.prototype.hasOwnProperty.call(arrayDescriptor, 'value')) {
          ancestors.pop();
          return rejectUnsupportedOutpatientEmrJson(fieldName);
        }
        cloned.push(cloneOutpatientEmrJsonValue(
          arrayDescriptor.value,
          fieldName + '[' + arrayIndex + ']',
          ancestors
        ));
      }
    } else {
      var propertyNames = Object.getOwnPropertyNames(value);
      var enumerableKeys = Object.keys(value);
      if (propertyNames.length !== enumerableKeys.length) {
        ancestors.pop();
        return rejectUnsupportedOutpatientEmrJson(fieldName);
      }
      cloned = {};
      for (var keyIndex = 0; keyIndex < enumerableKeys.length; keyIndex++) {
        var key = enumerableKeys[keyIndex];
        var descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          ancestors.pop();
          return rejectUnsupportedOutpatientEmrJson(fieldName);
        }
        Object.defineProperty(cloned, key, {
          configurable: true,
          enumerable: true,
          value: cloneOutpatientEmrJsonValue(
            descriptor.value,
            fieldName + '.' + key,
            ancestors
          ),
          writable: true
        });
      }
    }
    ancestors.pop();
    return cloned;
  }

  function cloneOutpatientEmrJsonObject(value, fieldName) {
    if (!isStrictOutpatientEmrJsonObject(value)) {
      throw new Error('analyzeOutpatientEmr ' + fieldName + ' 必须是严格 JSON 对象');
    }
    return cloneOutpatientEmrJsonValue(value, fieldName, []);
  }

  function stableOutpatientEmrJsonValue(value) {
    if (Array.isArray(value)) {
      return value.map(stableOutpatientEmrJsonValue);
    }
    if (!isPlainObject(value)) return value;
    var normalized = {};
    Object.keys(value).sort().forEach(function (key) {
      normalized[key] = stableOutpatientEmrJsonValue(value[key]);
    });
    return normalized;
  }

  function isInpatientEmrConfirmedRecord(record) {
    return !!record
      && (record.resultType === 'record-confirmed' || !record.resultType)
      && record.emrType === 'inpatient-emr';
  }

  function matchesInpatientEmrPending(pending, record, event) {
    if (!pending || !record) return false;
    var recordAdmissionId = stringValue(record.admissionId || (event && event.consultationId));
    if (pending.admissionId && recordAdmissionId && pending.admissionId !== recordAdmissionId) {
      return false;
    }
    if (pending.requestId) {
      return pending.requestId === stringValue(record.requestId);
    }
    return true;
  }

  function isOutpatientEmrConfirmedRecord(record) {
    return !!record
      && record.resultType === 'record-confirmed'
      && record.emrType === 'outpatient-emr';
  }

  function isOutpatientEmrStringMap(value) {
    if (!isPlainObject(value)) return false;
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) {
      if (typeof value[keys[i]] !== 'string') return false;
    }
    return true;
  }

  var OUTPATIENT_EMR_RECORD_FIELDS = [
    'chiefComplaint',
    'historyOfPresentIllness',
    'pastMedicalHistory',
    'personalHistory',
    'menstrualHistory',
    'familyHistory',
    'physicalExam',
    'precautions'
  ];
  var OUTPATIENT_EMR_MAPPING_SOURCES = [
    'definition-record-field',
    'definition-article-record-field',
    'canonical-id',
    'deterministic-alias',
    'deterministic-article',
    'unmapped'
  ];
  var OUTPATIENT_EMR_ORDER_TYPES = ['medicine', 'exam', 'lab_test', 'procedure'];

  function includesOutpatientEmrValue(values, value) {
    return values.indexOf(value) >= 0;
  }

  function composeOutpatientEmrSectionValue(fields, fieldValues) {
    var parts = [];
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      var value = fieldValues[field.id].replace(/\r\n?/g, '\n').trim();
      if (!value) continue;
      var source = field.name.trim() || field.id.trim();
      var label = source.replace(/标志$/, '').trim() || source;
      var escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var alreadyLabeled = new RegExp('^' + escapedLabel + '[：:]').test(value);
      parts.push(alreadyLabeled ? value : label + '：' + value);
    }
    return parts.join('；');
  }

  function isCompleteOutpatientEmrTemplateMetadata(metadata) {
    if (
      !isPlainObject(metadata)
      || metadata.schemaVersion !== 'outpatient-emr-template-pair.v1'
      || !isExactNonEmptyString(metadata.templateId)
      || !isExactNonEmptyString(metadata.templateName)
      || typeof metadata.templateHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(metadata.templateHash)
      || !Array.isArray(metadata.fields)
      || !metadata.fields.length
    ) {
      return false;
    }

    var seenFieldIds = Object.create(null);
    for (var i = 0; i < metadata.fields.length; i++) {
      var field = metadata.fields[i];
      if (
        !isPlainObject(field)
        || !isExactNonEmptyString(field.id)
        || seenFieldIds[field.id]
        || !isExactNonEmptyString(field.name)
        || !isExactNonEmptyString(field.type)
        || !isExactNonEmptyString(field.articleTemplateId)
        || !isExactNonEmptyString(field.articleId)
        || !isExactNonEmptyString(field.articleName)
        || !isExactNonEmptyString(field.articleDefinitionName)
        || !Array.isArray(field.dictionaryItems)
        || (field.recordField !== null
          && !includesOutpatientEmrValue(OUTPATIENT_EMR_RECORD_FIELDS, field.recordField))
        || !includesOutpatientEmrValue(OUTPATIENT_EMR_MAPPING_SOURCES, field.mappingSource)
        || (field.projectionMode !== null
          && field.projectionMode !== 'direct'
          && field.projectionMode !== 'section-compose')
      ) {
        return false;
      }
      if (
        (field.recordField === null
          && (field.mappingSource !== 'unmapped' || field.projectionMode !== null))
        || (field.recordField !== null
          && (field.mappingSource === 'unmapped' || field.projectionMode === null))
      ) {
        return false;
      }
      seenFieldIds[field.id] = true;
      var seenDictionaryTokens = Object.create(null);
      for (var itemIndex = 0; itemIndex < field.dictionaryItems.length; itemIndex++) {
        var item = field.dictionaryItems[itemIndex];
        if (
          !isPlainObject(item)
          || typeof item.value !== 'string'
          || item.value !== item.value.trim()
          || !isExactNonEmptyString(item.text)
        ) {
          return false;
        }
        var itemTokens = item.value === item.text
          ? [item.value]
          : [item.value, item.text];
        for (var tokenIndex = 0; tokenIndex < itemTokens.length; tokenIndex++) {
          var tokenKey = '$' + itemTokens[tokenIndex];
          if (seenDictionaryTokens[tokenKey]) return false;
          seenDictionaryTokens[tokenKey] = true;
        }
      }
    }
    return true;
  }

  function isCompleteOutpatientEmrConfirmedRecord(record, pending) {
    var metadata = record.templateMetadata;
    var standaloneReferenceMessage = '等待 HIS 完成门诊模板参数回填并回执';
    var combinedReferenceMessage = '等待 HIS 完成动态模板及已选诊疗内容回写并回执';
    var isStandaloneResult = record.referenceMessage === standaloneReferenceMessage;
    var isCombinedResult = record.referenceMessage === combinedReferenceMessage;
    if (
      !isExactNonEmptyString(record.consultationId)
      || !isExactNonEmptyString(record.visitId)
      || record.consultationId !== record.visitId
      || !isExactNonEmptyString(record.requestId)
      || (pending && record.consultationId !== pending.visitId)
      || (pending && record.requestId !== pending.requestId)
      || typeof record.timestamp !== 'number'
      || !isFinite(record.timestamp)
      || record.referenceType !== 'batch'
      || record.action !== 'batch'
      || record.referenceStatus !== 'pending'
      || (!isStandaloneResult && !isCombinedResult)
      || (pending && isCombinedResult)
      || !isCompleteOutpatientEmrTemplateMetadata(metadata)
      || (pending && metadata.templateId !== pending.templateId)
      || (pending && metadata.templateName !== pending.templateName)
      || !isOutpatientEmrStringMap(record.fieldValues)
      || !isPlainObject(record.dictionarySelections)
      || !isPlainObject(record.writebackScope)
      || !Array.isArray(record.writebackScope.recordFields)
      || !Array.isArray(record.writebackScope.orderTypes)
      || !Array.isArray(record.orderList)
    ) {
      return false;
    }
    if (
      isStandaloneResult
      && (
        record.writebackScope.includeDiagnosis !== false
        || record.writebackScope.orderTypes.length !== 0
        || record.orderList.length !== 0
      )
    ) {
      return false;
    }
    if (isCombinedResult) {
      if (typeof record.writebackScope.includeDiagnosis !== 'boolean') return false;
      var seenScopeFields = Object.create(null);
      for (var scopeFieldIndex = 0; scopeFieldIndex < record.writebackScope.recordFields.length; scopeFieldIndex++) {
        var scopeField = record.writebackScope.recordFields[scopeFieldIndex];
        if (!includesOutpatientEmrValue(OUTPATIENT_EMR_RECORD_FIELDS, scopeField) || seenScopeFields[scopeField]) {
          return false;
        }
        seenScopeFields[scopeField] = true;
      }
      var seenOrderTypes = Object.create(null);
      for (var orderTypeIndex = 0; orderTypeIndex < record.writebackScope.orderTypes.length; orderTypeIndex++) {
        var orderType = record.writebackScope.orderTypes[orderTypeIndex];
        if (!includesOutpatientEmrValue(OUTPATIENT_EMR_ORDER_TYPES, orderType) || seenOrderTypes[orderType]) {
          return false;
        }
        seenOrderTypes[orderType] = true;
      }
      if (
        (record.writebackScope.includeDiagnosis && !Array.isArray(record.diagList))
        || (!record.writebackScope.includeDiagnosis && record.diagList !== undefined)
        || (!record.writebackScope.orderTypes.length && record.orderList.length)
      ) {
        return false;
      }
    }

    var valueKeys = Object.keys(record.fieldValues);
    if (valueKeys.length !== metadata.fields.length) return false;
    var dictionaryFieldCount = 0;
    for (var i = 0; i < metadata.fields.length; i++) {
      var field = metadata.fields[i];
      if (!Object.prototype.hasOwnProperty.call(record.fieldValues, field.id)) return false;
      if (!field.dictionaryItems.length) {
        if (Object.prototype.hasOwnProperty.call(record.dictionarySelections, field.id)) return false;
        continue;
      }

      dictionaryFieldCount += 1;
      var selection = record.dictionarySelections[field.id];
      if (
        !isPlainObject(selection)
        || typeof selection.value !== 'string'
        || typeof selection.text !== 'string'
        || selection.text !== record.fieldValues[field.id]
      ) {
        return false;
      }
      var matched = false;
      for (var itemIndex = 0; itemIndex < field.dictionaryItems.length; itemIndex++) {
        var item = field.dictionaryItems[itemIndex];
        if (item.value === selection.value && item.text === selection.text) {
          matched = true;
          break;
        }
      }
      if (!matched) return false;
    }
    if (Object.keys(record.dictionarySelections).length !== dictionaryFieldCount) return false;

    var mappedRecordFields = Object.create(null);
    for (var metadataIndex = 0; metadataIndex < metadata.fields.length; metadataIndex++) {
      var mappedField = metadata.fields[metadataIndex];
      if (mappedField.recordField !== null) mappedRecordFields[mappedField.recordField] = true;
    }
    var expectedRecordFields = OUTPATIENT_EMR_RECORD_FIELDS.filter(function (recordField) {
      return mappedRecordFields[recordField] === true;
    });
    if (isCombinedResult) {
      var combinedRecordFields = record.writebackScope.recordFields;
      if (!combinedRecordFields.length) {
        return record.outpatientRecord === undefined;
      }
      if (
        !isPlainObject(record.outpatientRecord)
        || record.outpatientRecord.schemaVersion !== 'outpatient-record.v1'
      ) {
        return false;
      }
      var combinedRecordKeys = Object.keys(record.outpatientRecord);
      for (var combinedKeyIndex = 0; combinedKeyIndex < combinedRecordKeys.length; combinedKeyIndex++) {
        var combinedKey = combinedRecordKeys[combinedKeyIndex];
        if (combinedKey === 'schemaVersion') continue;
        if (
          !includesOutpatientEmrValue(combinedRecordFields, combinedKey)
          || typeof record.outpatientRecord[combinedKey] !== 'string'
        ) {
          return false;
        }
      }
      for (var combinedFieldIndex = 0; combinedFieldIndex < combinedRecordFields.length; combinedFieldIndex++) {
        var combinedField = combinedRecordFields[combinedFieldIndex];
        if (
          combinedField !== 'menstrualHistory'
          && !Object.prototype.hasOwnProperty.call(record.outpatientRecord, combinedField)
        ) {
          return false;
        }
        if (!mappedRecordFields[combinedField]) continue;
        var combinedOwners = metadata.fields.filter(function (field) {
          return field.recordField === combinedField;
        });
        if (combinedOwners.length === 1 && combinedOwners[0].projectionMode === 'direct') {
          if (record.outpatientRecord[combinedField] !== record.fieldValues[combinedOwners[0].id]) {
            return false;
          }
          continue;
        }
        var combinedArticleId = combinedOwners.length ? combinedOwners[0].articleId : '';
        if (
          !combinedArticleId
          || !combinedOwners.length
          || !combinedOwners.every(function (field) {
            return field.articleId === combinedArticleId && field.projectionMode === 'section-compose';
          })
          || record.outpatientRecord[combinedField]
            !== composeOutpatientEmrSectionValue(combinedOwners, record.fieldValues)
        ) {
          return false;
        }
      }
      return true;
    }
    if (record.writebackScope.recordFields.length !== expectedRecordFields.length) return false;
    for (var scopeIndex = 0; scopeIndex < expectedRecordFields.length; scopeIndex++) {
      if (record.writebackScope.recordFields[scopeIndex] !== expectedRecordFields[scopeIndex]) {
        return false;
      }
    }

    if (!expectedRecordFields.length) {
      return record.outpatientRecord === undefined;
    }
    if (
      !isPlainObject(record.outpatientRecord)
      || record.outpatientRecord.schemaVersion !== 'outpatient-record.v1'
      || Object.keys(record.outpatientRecord).length !== expectedRecordFields.length + 1
    ) {
      return false;
    }
    for (var recordIndex = 0; recordIndex < expectedRecordFields.length; recordIndex++) {
      var recordField = expectedRecordFields[recordIndex];
      if (
        !Object.prototype.hasOwnProperty.call(record.outpatientRecord, recordField)
        || typeof record.outpatientRecord[recordField] !== 'string'
      ) {
        return false;
      }
      var owners = metadata.fields.filter(function (field) {
        return field.recordField === recordField;
      });
      if (owners.length === 1 && owners[0].projectionMode === 'direct') {
        if (record.outpatientRecord[recordField] !== record.fieldValues[owners[0].id]) {
          return false;
        }
        continue;
      }
      var articleId = owners.length ? owners[0].articleId : '';
      if (
        !articleId
        || !owners.length
        || !owners.every(function (field) {
          return field.articleId === articleId && field.projectionMode === 'section-compose';
        })
        || record.outpatientRecord[recordField]
          !== composeOutpatientEmrSectionValue(owners, record.fieldValues)
      ) {
        return false;
      }
    }
    return true;
  }

  function getOutpatientEmrTemplateId(record) {
    if (!record || !isPlainObject(record.templateMetadata)) return '';
    return typeof record.templateMetadata.templateId === 'string'
      ? record.templateMetadata.templateId
      : '';
  }

  function isStrictOutpatientEmrTargetFieldIds(targetFieldIds) {
    if (!Array.isArray(targetFieldIds) || !targetFieldIds.length) return false;
    var seen = Object.create(null);
    for (var i = 0; i < targetFieldIds.length; i++) {
      var fieldId = targetFieldIds[i];
      if (!isExactNonEmptyString(fieldId) || seen[fieldId]) return false;
      seen[fieldId] = true;
    }
    return true;
  }

  function getOutpatientEmrRequestSnapshotKey(payload) {
    return JSON.stringify(stableOutpatientEmrJsonValue({
      requestId: payload.requestId,
      visitId: payload.visitId,
      templateId: payload.templateId,
      templateName: payload.templateName,
      templateHtml: payload.templateHtml,
      templateDefinition: payload.templateDefinition,
      targetFieldIds: payload.targetFieldIds.slice().sort(),
      patient: payload.patient || null,
      recordContext: payload.recordContext
    }));
  }

  function matchesOutpatientEmrRequestSnapshot(pending, payload) {
    return pending.requestSnapshotKey === getOutpatientEmrRequestSnapshotKey(payload);
  }

  function matchesOutpatientEmrPending(pending, record) {
    if (!pending || !record) return false;
    var recordTemplateId = getOutpatientEmrTemplateId(record);
    return !!pending.visitId
      && pending.visitId === record.consultationId
      && pending.visitId === record.visitId
      && !!pending.requestId
      && pending.requestId === record.requestId
      && !!pending.templateId
      && pending.templateId === recordTemplateId;
  }

  function isOutpatientEmrCancelledRecord(record) {
    return !!record
      && record.emrType === 'outpatient-emr'
      && record.resultType === 'cancelled'
      && record.status === 'cancelled'
      && isExactNonEmptyString(record.consultationId)
      && isExactNonEmptyString(record.visitId)
      && isExactNonEmptyString(record.requestId)
      && typeof record.timestamp === 'number'
      && isFinite(record.timestamp);
  }

  function matchesOutpatientEmrCancellation(pending, record) {
    if (!pending || !record) return false;
    return !!pending.visitId
      && pending.visitId === record.consultationId
      && pending.visitId === record.visitId
      && !!pending.requestId
      && pending.requestId === record.requestId;
  }

  // ─── 事件发射器 ───

  function EventEmitter() {
    this._listeners = {};
  }

  EventEmitter.prototype.on = function (event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
    return this;
  };

  EventEmitter.prototype.off = function (event, fn) {
    if (!this._listeners[event]) return this;
    if (!fn) {
      delete this._listeners[event];
      return this;
    }
    this._listeners[event] = this._listeners[event].filter(function (f) { return f !== fn; });
    return this;
  };

  EventEmitter.prototype.emit = function (event) {
    var args = Array.prototype.slice.call(arguments, 1);
    var listeners = this._listeners[event];
    if (listeners) {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i].apply(null, args); } catch (e) { console.error('[MedHermes] Event handler error:', e); }
      }
    }
    return this;
  };

  EventEmitter.prototype.hasAnyListeners = function (eventMap) {
    for (var event in eventMap) {
      if (!Object.prototype.hasOwnProperty.call(eventMap, event)) continue;
      if (this._listeners[event] && this._listeners[event].length > 0) return true;
    }
    return false;
  };

  // ─── HTTP 客户端 ───

  function HttpClient(baseUrl, timeout) {
    this.baseUrl = baseUrl;
    this.timeout = timeout || 5000;
  }

  HttpClient.prototype.post = function (path, payload, headers) {
    var url = this.baseUrl + path;
    var timeoutMs = this.timeout;

    return new Promise(function (resolve, reject) {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (controller) controller.abort();
        reject(new Error('Request timeout'));
      }, timeoutMs);

      var opts = {
        method: 'POST',
        headers: assign({ 'Content-Type': 'application/json' }, headers || {}),
        body: JSON.stringify(payload || {})
      };
      if (controller) opts.signal = controller.signal;

      fetch(url, opts)
        .then(function (res) {
          clearTimeout(timer);
          return res.text().then(function (text) {
            var body;
            try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
            if (!res.ok) {
              var err = new Error(typeof body === 'string' ? body : JSON.stringify(body));
              err.status = res.status;
              err.body = body;
              throw err;
            }
            return body;
          });
        })
        .then(resolve)
        .catch(function (err) {
          clearTimeout(timer);
          reject(err);
        });
    });
  };

  HttpClient.prototype.get = function (path) {
    var url = this.baseUrl + path;
    var timeoutMs = this.timeout;

    return new Promise(function (resolve, reject) {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (controller) controller.abort();
        reject(new Error('Request timeout'));
      }, timeoutMs);

      var opts = {};
      if (controller) opts.signal = controller.signal;

      fetch(url, opts)
        .then(function (res) {
          clearTimeout(timer);
          return res.text().then(function (text) {
            var body;
            try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
            if (!res.ok) {
              var err = new Error(typeof body === 'string' ? body : JSON.stringify(body));
              err.status = res.status;
              err.body = body;
              throw err;
            }
            return body;
          });
        })
        .then(resolve)
        .catch(function (err) {
          clearTimeout(timer);
          reject(err);
        });
    });
  };

  // ─── 协议拉起器 ───

  function Launcher(scheme) {
    this.scheme = scheme || 'med-hermes';
  }

  Launcher.prototype.launch = function (path, params) {
    var url = this.scheme + '://' + (path || 'launch');
    if (params) {
      try {
        url += '?data=' + encodeURIComponent(JSON.stringify(params));
      } catch (_) { /* ignore */ }
    }
    // 使用 iframe 方式触发协议，兼容性最佳
    var iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    setTimeout(function () {
      try { document.body.removeChild(iframe); } catch (_) { /* ignore */ }
    }, 3000);
  };

  // ─── 浏览器上下文采集 ───

  function collectBrowserContext(extra) {
    return {
      origin: (function() {
        if (typeof location === 'undefined') return '';
        var origin = location.origin;
        var pathname = location.pathname;
        var contextPath = '';
        if (pathname && pathname.length > 1) {
          var segments = pathname.split('/');
          // 如果路径类似 /his-web/xxx，则提取 /his-web
          // 注意排除常见的前端路由或静态资源目录，如果有特定的应用名可以更精确匹配
          if (segments.length > 1 && segments[1] && segments[1].indexOf('.html') === -1) {
             contextPath = '/' + segments[1];
          }
        }
        return origin + contextPath;
      })(),
      href: typeof location !== 'undefined' ? location.href : '',
      cookie: typeof document !== 'undefined' ? document.cookie : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      timestamp: Date.now(),
      sdkVersion: SDK_VERSION,
      extra: extra || {}
    };
  }

  function buildHandshakeContext(baseCtx, overrides) {
    var payload = assign({}, baseCtx || {}, overrides || {});
    var baseExtra = (baseCtx && baseCtx.extra && typeof baseCtx.extra === 'object') ? baseCtx.extra : {};
    var overrideExtra = (overrides && overrides.extra && typeof overrides.extra === 'object') ? overrides.extra : {};

    payload.extra = assign({}, baseExtra, overrideExtra);
    payload.timestamp = Date.now();
    return payload;
  }

  // ─── 主类 ───

  /**
   * MedHermes SDK 主类
   *
   * @param {Object} [options]
   * @param {string} [options.baseUrl='http://127.0.0.1:8081/api'] 本地桥接地址
   * @param {number} [options.wsReconnectMs=1000] WebSocket 首次重连等待时间
   * @param {number} [options.wsReconnectMaxMs=30000] WebSocket 重连退避上限
   * @param {string} [options.scheme='med-hermes'] 深度链接协议名
   * @param {number} [options.launchRetryMs=3000] 协议拉起后等待重连时间
   * @param {number} [options.timeout=5000] HTTP 请求超时时间
   * @param {Object} [options.extra] 自定义浏览器上下文扩展字段
   */
  function MedHermes(options) {
    var opts = assign({
      baseUrl: 'http://127.0.0.1:8081/api',
      wsReconnectMs: 1000,
      wsReconnectMaxMs: 30000,
      scheme: 'med-hermes',
      launchRetryMs: 3000,
      timeout: 20000,
      extra: {}
    }, options);

    this._opts = opts;
    this._http = new HttpClient(opts.baseUrl, opts.timeout);
    this._launcher = new Launcher(opts.scheme);
    this._emitter = new EventEmitter();
    this._ws = null;
    this._wsReconnectTimer = null;
    this._wsReconnectAttempt = 0;
    this._isChannelPersistent = false;
    this._isWsConnecting = false;
    this._subscriptionActive = false;
    this._disconnectedNotified = false;
    this._lastHandshakeResult = null;
    this._transport = 'idle';
    this._lastResultKey = '';
    this._lastEventId = '';
    this._connected = false;
    this._destroyed = false;
    this._browserCtx = null;
    this._currentPatientId = null;
    this._currentConsultationId = null;
    this._lastEventConsultationId = null;
    this._pendingInpatientEmrRequests = [];
    this._pendingOutpatientEmrRequests = [];
  }

  // 代理事件方法
  MedHermes.prototype.on = function (event, fn) { this._emitter.on(event, fn); return this; };
  MedHermes.prototype.off = function (event, fn) { this._emitter.off(event, fn); return this; };

  /**
   * 初始化 SDK：采集浏览器上下文 + 与桌面端握手
   * 如果桌面端不在线，会尝试通过协议拉起
   *
   * @returns {Promise<Object>} 握手结果
   */
  MedHermes.prototype.init = function (extra) {
    return this._initConnection(extra, false);
  };

  // Shared medical/public-health context collection, handshake and protocol launch.
  MedHermes.prototype._initConnection = function (extra, publicHealth) {
    var self = this;
    if (typeof WebSocket === 'undefined') {
      var unsupportedError = new Error('当前 HIS 浏览器不支持 WebSocket，无法初始化 MedHermes 结果事件通道');
      unsupportedError.code = 'WEBSOCKET_UNSUPPORTED';
      this._emitter.emit('error', unsupportedError);
      return Promise.reject(unsupportedError);
    }

    // 先尝试获取 HIS 上下文，然后再执行握手
    var contextExtra = publicHealth ? assign({}, this._browserCtx && this._browserCtx.extra, extra) : extra;
    return this._collectHISContext(contextExtra)
      .then(function (finalExtra) {
        self._browserCtx = collectBrowserContext(finalExtra);
        return self._handshake(publicHealth);
      })
      .then(function (result) {
        if (!publicHealth) {
          self._connected = true;
          self._isChannelPersistent = true;
          self._lastHandshakeResult = result;
          self._disconnectedNotified = false;
          self._ensureInteractionChannel(true);
          self._emitter.emit('connected', result);
        }
        return result;
      })
      .catch(function (err) {
        // A rejected medical context is actionable; launching again cannot authorize it.
        if (publicHealth && err && err.status >= 400 && err.status < 500) throw err;
        // 如果是 HIS 接口报错但不是连接报错，记录一下但继续尝试握手（除非是因为桌面端没启动）
        if (err && err.message && err.message.indexOf('MedHermes') === -1) {
          console.warn('[MedHermes] HIS context collection failed:', err);
        }

        // 桌面端不在线，尝试协议拉起
        self._emitter.emit('launching');
        self._launcher.launch('launch');

        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            self._handshake(publicHealth)
              .then(function (result) {
                if (!publicHealth) {
                  self._connected = true;
                  self._isChannelPersistent = true;
                  self._lastHandshakeResult = result;
                  self._disconnectedNotified = false;
                  self._ensureInteractionChannel(true);
                  self._emitter.emit('connected', result);
                }
                resolve(result);
              })
              .catch(function () {
                self._connected = false;
                self._emitter.emit('launch-failed');
                reject(new Error('全医慧助（PCIE）桌面端未启动，协议拉起失败'));
              });
          }, self._opts.launchRetryMs);
        });
      });
  };

  /**
   * 异步采集 HIS 特定上下文 (emrAccessToken, urt)
   * @private
   */
  MedHermes.prototype._collectHISContext = function (extra) {
    var self = this;
    var finalExtra = assign({}, this._opts.extra, extra);

    // 1. 获取 urt (同步)
    try {
      if (typeof $env !== 'undefined' && $env.globalContext && typeof $env.globalContext.get === 'function') {
        var urt = $env.globalContext.get('urt');
        if (urt) {
          finalExtra.urt = urt;
        }
      }
    } catch (e) {
      console.warn('[MedHermes] Failed to get urt from $env:', e);
    }

    // 2. 获取 accessToken (异步)
    if (typeof $ajax === 'function') {
      return new Promise(function (resolve) {
        try {
          $ajax({
            method: "POST",
            url: "api/base.publicService/emrAccessToken",
            timeout: 5000,
            jsonData: {}
          }).then(function (res) {
            if (res && res.body) {
              finalExtra.emrAccessToken = res.body;
              finalExtra.accessToken = res.body; // 兼容性字段
            }
            resolve(finalExtra);
          }).catch(function (err) {
            console.warn('[MedHermes] $ajax emrAccessToken failed:', err);
            resolve(finalExtra); // 报错也继续，不阻塞握手
          });
        } catch (e) {
          console.warn('[MedHermes] Error calling $ajax:', e);
          resolve(finalExtra);
        }
      });
    }

    return Promise.resolve(finalExtra);
  };

  /** 内部握手方法 */
  MedHermes.prototype._handshake = function (publicHealth) {
    var ctx = this._browserCtx || collectBrowserContext(this._opts.extra);
    var headers = {};
    if (publicHealth) {
      var ph = this._publicHealthState();
      ctx = assign({}, ctx, { publicHealth: { schemaVersion:'public-health.v1', sdkInstanceId:ph.instanceId } });
      if (ph.session) {
        ctx.publicHealth.resumeSessionId = ph.session.bridgeSessionId;
        headers['X-PCIE-Bridge-Token'] = ph.session.publicHealthBridgeToken;
      }
    }
    return this._http.post('/handshake', ctx, headers);
  };

  /**
   * 调试模式：手动覆盖握手入参。
   * 常用于联调页或非真实 HIS 环境下手动传入 emrAccessToken。
   * @param {Object} [overrides] 可覆盖 origin/href/cookie/userAgent/extra 等字段
   * @returns {Promise<Object>} 握手结果
   */
  MedHermes.prototype.debugHandshake = function (overrides) {
    if (typeof WebSocket === 'undefined') {
      var unsupportedError = new Error('当前 HIS 浏览器不支持 WebSocket，无法初始化 MedHermes 结果事件通道');
      unsupportedError.code = 'WEBSOCKET_UNSUPPORTED';
      this._emitter.emit('error', unsupportedError);
      return Promise.reject(unsupportedError);
    }

    this._browserCtx = buildHandshakeContext(
      this._browserCtx || collectBrowserContext(this._opts.extra),
      overrides
    );

    var self = this;
    return this._handshake().then(function (result) {
      self._connected = true;
      self._isChannelPersistent = true;
      self._lastHandshakeResult = result;
      self._disconnectedNotified = false;
      self._ensureInteractionChannel(true);
      self._emitter.emit('connected', result);
      return result;
    });
  };

  MedHermes.prototype._resumeEventChannelIfNeeded = function () {
    this._ensureInteractionChannel();
  };

  MedHermes.prototype._ensureInteractionChannel = function (handshakeReady) {
    if (this._destroyed || !this._isChannelPersistent) return;
    this._openPersistentWebSocket(handshakeReady === true);
  };

  /**
   * 检测全医慧助（PCIE）桌面端是否在线
   * @returns {Promise<Object>} 包含版本号等信息
   */
  MedHermes.prototype.ping = function () {
    return this._http.get('/health');
  };

  /**
   * 启动完整问诊
   * @param {Object} patient 患者信息（必须包含 idPi, naPi, sdSexText, ageText）
   * @returns {Promise<Object>}
   */
  MedHermes.prototype.startConsultation = function (patient) {
    var self = this;
    this._currentPatientId = getPatientId(patient);
    this._currentConsultationId = getPatientAnchorId(patient);
    this._lastResultKey = '';
    this._lastEventId = '';
    this._lastEventConsultationId = null;

    return this._callWithFallback(
      function () { return self._http.post('/consultation/start', patient); },
      'start-consultation',
      patient
    ).then(function (result) {
      self._resumeEventChannelIfNeeded();
      return result;
    });
  };

  /**
   * 灵活模式：直接进入指定 AI 模块
   * @param {Object} patient 患者信息
   * @param {string} action 动作类型: record/suggestedDx/diffDx/diagnosis/differential/medication/examination/lab_test/procedure/treatment_plan/reminder
   * @returns {Promise<Object>}
   */
  MedHermes.prototype.assist = function (patient, action) {
    var self = this;
    var payload = assign({}, patient, { action: action });
    this._currentPatientId = getPatientId(patient);
    this._currentConsultationId = getPatientAnchorId(patient);
    this._lastResultKey = '';
    this._lastEventId = '';
    this._lastEventConsultationId = null;

    return this._callWithFallback(
      function () { return self._http.post('/consultation/assist', payload); },
      'assist',
      payload
    ).then(function (result) {
      self._resumeEventChannelIfNeeded();
      return result;
    });
  };

  /**
   * 启动语音问诊
   * @param {Object} [patient] 患者信息（可选，不传则沿用桌面端当前上下文）
   * @returns {Promise<Object>}
   */
  MedHermes.prototype.startVoice = function (patient) {
    var self = this;
    var payload;
    try {
      payload = prepareVoicePatientPayload(patient);
    } catch (error) {
      return Promise.reject(error);
    }
    if (payload) {
      this._currentPatientId = getPatientId(payload);
      this._currentConsultationId = getPatientAnchorId(payload);
    }
    this._lastResultKey = '';
    this._lastEventId = '';
    this._lastEventConsultationId = null;

    return this._callWithFallback(
      function () { return self._http.post('/consultation/start-voice', payload || {}); },
      'voice-consultation',
      payload
    ).then(function (result) {
      self._resumeEventChannelIfNeeded();
      return result;
    });
  };

  /**
   * 触发检验/检查报告解读
   * @param {Object|string} request 报告解读请求对象，或 taskId
   * @param {string} [query] 报告原文（仅当第一个参数是 taskId 时使用）
   * @param {Object} [patient] 可选患者信息
   * @returns {Promise<Object>}
   */
  MedHermes.prototype.interpretReport = function (request, query, patient) {
    var self = this;
    var payload = (request && typeof request === 'object' && !Array.isArray(request))
      ? assign({}, request)
      : {
          taskId: request,
          query: query,
          patient: patient
        };

    if (!payload || !payload.taskId || !payload.query) {
      return Promise.reject(new Error('interpretReport 缺少 taskId 或 query'));
    }

    return this._callWithFallback(
      function () { return self._http.post('/report/interpret', payload); },
      'report-interpret',
      payload
    );
  };

  /**
   * 触发住院病历辅助生成
   * @param {Object|string} request 住院病历生成请求对象，或 admissionId
   * @param {string} [htmlContent] EMR 模板 htmlContent（仅当第一个参数是 admissionId 时使用）
   * @param {Object} [options] 可选扩展，如 templateName/recordTime/doctorSupplement/contextPolicy/hisContext/requestId/patient
   * @returns {Promise<Object>}
   */
  MedHermes.prototype.generateInpatientEmr = function (request, htmlContent, options) {
    var self = this;
    var payload = (request && typeof request === 'object' && !Array.isArray(request))
      ? assign({}, request)
      : assign({}, options || {}, {
          admissionId: request,
          htmlContent: htmlContent
        });

    if (!payload || !payload.admissionId || !payload.templateId || !payload.templateName || !payload.htmlContent) {
      return Promise.reject(new Error('generateInpatientEmr 缺少 admissionId、templateId、templateName 或 htmlContent'));
    }

    this._currentPatientId = payload.admissionId;
    this._currentConsultationId = payload.admissionId;
    this._lastResultKey = '';
    this._lastEventId = '';
    this._lastEventConsultationId = null;

    return this._callWithFallback(
      function () { return self._http.post('/inpatient/emr/generate', payload); },
      'inpatient-emr-generate',
      payload
    ).then(function (result) {
      self._resumeEventChannelIfNeeded();
      return self._waitForInpatientEmrWriteback(payload, result);
    });
  };

  /**
   * 按当前 HIS 门急诊模板分析一次病历上下文
   * @param {Object} request 门诊模板分析请求
   * @returns {Promise<Object>} 医生确认后的 record-confirmed payload
   */
  MedHermes.prototype.analyzeOutpatientEmr = function (request) {
    var self = this;
    if (!isPlainObject(request)) {
      return Promise.reject(new Error('analyzeOutpatientEmr 请求必须是对象'));
    }
    var allowedRequestFields = {
      visitId: true,
      templateId: true,
      templateName: true,
      templateHtml: true,
      templateDefinition: true,
      targetFieldIds: true,
      recordContext: true,
      patient: true,
      requestId: true
    };
    var requestFields = Object.keys(request);
    for (var requestFieldIndex = 0; requestFieldIndex < requestFields.length; requestFieldIndex++) {
      if (!allowedRequestFields[requestFields[requestFieldIndex]]) {
        return Promise.reject(new Error(
          'analyzeOutpatientEmr 请求包含未支持字段: ' + requestFields[requestFieldIndex]
        ));
      }
    }

    if (request.patient !== undefined && request.patient !== null) {
      if (!isPlainObject(request.patient)) {
        return Promise.reject(new Error('analyzeOutpatientEmr patient 必须是对象'));
      }
      var allowedPatientFields = {
        idPi: true,
        name: true,
        sdSexText: true,
        ageText: true
      };
      var patientFields = Object.keys(request.patient);
      for (var patientFieldIndex = 0; patientFieldIndex < patientFields.length; patientFieldIndex++) {
        if (!allowedPatientFields[patientFields[patientFieldIndex]]) {
          return Promise.reject(new Error(
            'analyzeOutpatientEmr patient 只接受 idPi、name、sdSexText、ageText'
          ));
        }
        var patientValue = request.patient[patientFields[patientFieldIndex]];
        if (typeof patientValue !== 'string' || patientValue !== patientValue.trim()) {
          return Promise.reject(new Error(
            'analyzeOutpatientEmr patient 字段必须是无首尾空白的字符串'
          ));
        }
      }
    }

    if (
      !isExactNonEmptyString(request.visitId)
      || !isExactNonEmptyString(request.templateId)
      || !isExactNonEmptyString(request.templateName)
      || !isExactNonEmptyString(request.requestId)
      || typeof request.templateHtml !== 'string'
      || !request.templateHtml.trim()
      || typeof request.templateDefinition !== 'string'
      || !request.templateDefinition.trim()
      || !isStrictOutpatientEmrTargetFieldIds(request.targetFieldIds)
      || !isPlainObject(request.recordContext)
    ) {
      return Promise.reject(new Error(
        'analyzeOutpatientEmr 要求无首尾空白的 visitId、templateId、templateName、requestId，非空 templateHtml、templateDefinition、唯一 targetFieldIds 和 recordContext'
      ));
    }

    var recordContext;
    var patient;
    try {
      recordContext = cloneOutpatientEmrJsonObject(request.recordContext, 'recordContext');
      patient = request.patient === undefined || request.patient === null
        ? null
        : cloneOutpatientEmrJsonObject(request.patient, 'patient');
    } catch (error) {
      return Promise.reject(error);
    }
    if (!hasNonEmptyOutpatientEmrFact(recordContext, [])) {
      return Promise.reject(new Error(
        'analyzeOutpatientEmr recordContext 至少需要一项非空临床事实'
      ));
    }

    var payload = {
      visitId: request.visitId,
      templateId: request.templateId,
      templateName: request.templateName,
      templateHtml: request.templateHtml,
      templateDefinition: request.templateDefinition,
      targetFieldIds: request.targetFieldIds.slice(),
      recordContext: recordContext,
      requestId: request.requestId
    };
    if (patient) payload.patient = patient;

    var existingPending = this._findActiveOutpatientEmrRequest(payload);
    if (existingPending) {
      return existingPending.promise;
    }
    if (this._hasOutpatientEmrRequestIdConflict(payload)) {
      return Promise.reject(new Error(
        'REQUEST_ID_CONFLICT: 同一 requestId 不能用于不同就诊、模板 snapshot 或目标字段范围'
      ));
    }
    this._rejectReplacedOutpatientEmrRequests(payload);

    this._currentPatientId = payload.visitId;
    this._currentConsultationId = payload.visitId;
    this._lastResultKey = '';
    this._lastEventId = '';
    this._lastEventConsultationId = null;

    return this._waitForOutpatientEmrWriteback(payload, function () {
      return self._callWithFallback(
        function () { return self._http.post('/outpatient/emr/analyze', payload); },
        'launch'
      );
    });
  };

  /**
   * 结束当前接诊
   * @returns {Promise<Object>}
   */
  MedHermes.prototype.stop = function () {
    var self = this;
    this._currentPatientId = null;
    this._currentConsultationId = null;
    this._lastEventConsultationId = null;
    return this._callWithFallback(
      function () { return self._http.post('/consultation/stop', {}); },
      'stop-consultation',
      {}
    )
      .then(function (result) {
        self._resumeEventChannelIfNeeded();
        return result;
      });
  };

  /**
   * 接收患者接诊
   * @param {string} patientId 患者 ID
   * @param {Object} [optionalInfo] 可选辅助信息
   * @returns {Promise<Object>}
   */
  MedHermes.prototype.receivePatient = function (patientId, optionalInfo) {
    var self = this;
    var payload = assign({ idPi: patientId }, optionalInfo || {});
    this._currentPatientId = getPatientId(payload);
    this._currentConsultationId = getPatientAnchorId(payload);
    this._lastResultKey = '';
    this._lastEventId = '';
    this._lastEventConsultationId = null;

    return this._callWithFallback(
      function () { return self._http.post('/consultation/receive', payload); },
      'receive-patient',
      payload
    ).then(function (result) {
      self._resumeEventChannelIfNeeded();
      return result;
    });
  };

  /**
   * 推送患者风险信息
   * @param {Object} patient 患者信息
   * @param {Array} [risks] 预计算风险项（不传则由 LLM 自动分析）
   * @returns {Promise<Object>}
   */
  MedHermes.prototype.sendRisks = function (patient, risks) {
    var self = this;
    var payload = assign({}, patient);
    if (risks) payload.risks = risks;
    return this._callWithFallback(
      function () { return self._http.post('/patient/risks', payload); },
      'patient-risks',
      payload
    );
  };

  /**
   * 发送 PHIS 引用回执
   * @param {string} requestId 对应 reference-request 中的 requestId
   * @param {string} status 'success' / 'failed' / 'pending' / 'cancelled'
   * @param {string} [message] 成功说明或失败原因
   * @param {Array} [items] 实际保存的项目列表
   * @returns {Promise<Object>}
   */
  MedHermes.prototype.sendFeedback = function (requestId, status, message, items) {
    var self = this;
    var payload = {
      consultationId: this._lastEventConsultationId || this._currentConsultationId || this._currentPatientId || '',
      requestId: requestId,
      referenceType: 'batch',
      action: 'batch',
      status: status,
      message: message || (status === 'success'
        ? 'PHIS 保存成功'
        : status === 'pending'
          ? '等待医生完成互认决策'
          : status === 'cancelled'
            ? '医生取消了互认决策'
            : 'PHIS 保存失败'),
      items: items || []
    };

    return this._callWithFallback(
      function () { return self._http.post('/consultation/reference-feedback', payload); },
      'reference-feedback',
      payload
    )
      .then(function (result) {
        self._resumeEventChannelIfNeeded();
        return result;
      });
  };

  /**
   * 订阅事件流；返回取消订阅函数
   * @param {Function} listener
   * @returns {Function}
   */
  MedHermes.prototype.subscribe = function (listener) {
    var self = this;
    if (typeof listener !== 'function') {
      throw new TypeError('subscribe requires a function listener');
    }

    var hadStreamListeners = this._emitter.hasAnyListeners(STREAM_EVENT_NAMES);
    this.on('event', listener);
    if (!hadStreamListeners) {
      this._subscriptionActive = true;
      this._emitter.emit('subscription-start');
    }
    this._ensureInteractionChannel();

    return function unsubscribe() {
      self.off('event', listener);
      if (self._subscriptionActive && !self._emitter.hasAnyListeners(STREAM_EVENT_NAMES)) {
        self._subscriptionActive = false;
        self._emitter.emit('subscription-stop');
      }
    };
  };

  MedHermes.prototype._clearWebSocketReconnectTimer = function () {
    if (!this._wsReconnectTimer) return;
    clearTimeout(this._wsReconnectTimer);
    this._wsReconnectTimer = null;
  };

  MedHermes.prototype._markDisconnected = function () {
    this._connected = false;
    if (this._disconnectedNotified) return false;
    this._disconnectedNotified = true;
    this._emitter.emit('disconnected');
    return true;
  };

  MedHermes.prototype._scheduleWebSocketReconnect = function () {
    if (this._destroyed || !this._isChannelPersistent || this._wsReconnectTimer) return;

    var baseDelay = Number(this._opts.wsReconnectMs) || 1000;
    var maxDelay = Number(this._opts.wsReconnectMaxMs) || 30000;
    baseDelay = Math.max(250, baseDelay);
    maxDelay = Math.max(baseDelay, maxDelay);
    var delay = Math.min(maxDelay, baseDelay * Math.pow(2, this._wsReconnectAttempt));
    this._wsReconnectAttempt += 1;

    var self = this;
    this._wsReconnectTimer = setTimeout(function () {
      self._wsReconnectTimer = null;
      self._openPersistentWebSocket(false);
    }, delay);
  };

  MedHermes.prototype._openPersistentWebSocket = function (handshakeReady) {
    if (this._destroyed || !this._isChannelPersistent) return;
    if (this._ws || this._isWsConnecting) return;

    if (typeof WebSocket === 'undefined') {
      var unsupportedError = new Error('当前 HIS 浏览器不支持 WebSocket，无法订阅 MedHermes 结果事件');
      unsupportedError.code = 'WEBSOCKET_UNSUPPORTED';
      this._markDisconnected();
      this._emitter.emit('error', unsupportedError);
      return;
    }

    var self = this;
    this._clearWebSocketReconnectTimer();
    this._isWsConnecting = true;
    this._transport = 'websocket';

    if (handshakeReady) {
      this._establishWebSocket();
      return;
    }

    // 重新连接时，先尝试进行握手授权。握手成功后（确保后端获得浏览器上下文且通过安全校验）再建立 WebSocket 连接，避免 401 Unauthorized 升级拦截。
    this._handshake()
      .then(function (result) {
        self._connected = true;
        self._lastHandshakeResult = result;
        console.log('[MedHermes] Re-handshake succeeded, establishing WebSocket connection');
        self._establishWebSocket();
      })
      .catch(function (err) {
        self._isWsConnecting = false;
        if (self._markDisconnected()) {
          console.warn('[MedHermes] Re-handshake failed, retrying with backoff:', err && err.message || err);
        }
        self._scheduleWebSocketReconnect();
      });
  };

  MedHermes.prototype._establishWebSocket = function () {
    if (this._destroyed || this._ws) {
      this._isWsConnecting = false;
      return;
    }

    var self = this;

    try {
      var ws = new WebSocket(buildEventWebSocketUrl(this._opts.baseUrl, this._lastEventId));
      this._ws = ws;

      ws.onopen = function () {
        self._isWsConnecting = false;
        self._connected = true;
        self._wsReconnectAttempt = 0;
        self._clearWebSocketReconnectTimer();
        self._emitter.emit('subscription-transport', { transport: 'websocket', state: 'connected' });
        if (self._disconnectedNotified) {
          self._disconnectedNotified = false;
          self._emitter.emit('connected', self._lastHandshakeResult || { reconnected: true });
        }
        console.log('[MedHermes] WebSocket connected successfully');
        // 连接成功后，恢复先前中断的接诊状态
        self._restoreActiveSessionIfNeeded();
      };

      ws.onmessage = function (message) {
        if (!message || typeof message.data !== 'string' || message.data === 'pong') return;

        var parsed;
        try {
          parsed = JSON.parse(message.data);
        } catch (e) {
          console.warn('[MedHermes] Invalid WebSocket event payload:', message.data);
          return;
        }

        var envelope = normalizeEventEnvelope(parsed);
        if (!envelope || envelope.state === 'pending' || !envelope.event) return;

        var event = envelope.event;
        var record = event.payload || {};
        if (envelope.state === 'cancelled' || event.type === 'cancelled') {
          self._dispatchEnvelope(envelope);
          var cancelErr = new Error(record.reason || 'Consultation cancelled by user');
          cancelErr.code = 'CANCELLED';
          cancelErr.result = envelope;
          self._emitter.emit('error', cancelErr);
          return;
        }

        self._dispatchEnvelope(envelope);
      };

      ws.onerror = function () {
        self._isWsConnecting = false;
        self._emitter.emit('subscription-transport', { transport: 'websocket', state: 'error' });
      };

      ws.onclose = function () {
        self._isWsConnecting = false;
        if (self._ws === ws) self._ws = null;
        if (self._destroyed || !self._isChannelPersistent) return;

        self._emitter.emit('subscription-transport', { transport: 'websocket', state: 'closed' });
        self._markDisconnected();
        self._scheduleWebSocketReconnect();
      };
    } catch (err) {
      this._isWsConnecting = false;
      this._emitter.emit('error', err);
      this._markDisconnected();
      this._scheduleWebSocketReconnect();
    }
  };

  MedHermes.prototype._restoreActiveSessionIfNeeded = function () {
    if (!this._activeSession) return;

    var self = this;
    var session = this._activeSession;
    console.log('[MedHermes] Restoring active consultation session:', session);

    if (session.type === 'consultation') {
      this._http.post('/consultation/start', session.patient)
        .then(function () {
          console.log('[MedHermes] Consultation session auto-restored successfully');
        })
        .catch(function (e) {
          console.error('[MedHermes] Auto-restore consultation failed:', e);
        });
    } else if (session.type === 'assist') {
      var payload = assign({}, session.patient, { action: session.action });
      this._http.post('/consultation/assist', payload)
        .then(function () {
          console.log('[MedHermes] Assist session auto-restored successfully');
        })
        .catch(function (e) {
          console.error('[MedHermes] Auto-restore assist failed:', e);
        });
    } else if (session.type === 'voice') {
      this._http.post('/consultation/start-voice', session.patient || {})
        .then(function () {
          console.log('[MedHermes] Voice session auto-restored successfully');
        })
        .catch(function (e) {
          console.error('[MedHermes] Auto-restore voice failed:', e);
        });
    } else if (session.type === 'receive') {
      var payload = assign({ idPi: session.patientId }, session.optionalInfo || {});
      this._http.post('/consultation/receive', payload)
        .then(function () {
          console.log('[MedHermes] Receive session auto-restored successfully');
        })
        .catch(function (e) {
          console.error('[MedHermes] Auto-restore receive failed:', e);
        });
    }
  };

  /** 销毁实例，清理全部资源 */
  MedHermes.prototype.destroy = function () {
    this._destroyed = true;
    this._destroyPublicHealth();
    this._isChannelPersistent = false;
    if (this._subscriptionActive) {
      this._subscriptionActive = false;
      this._emitter.emit('subscription-stop');
    }
    this._clearWebSocketReconnectTimer();
    if (this._ws) {
      try { this._ws.close(); } catch (e) {}
      this._ws = null;
    }
    this._emitter = new EventEmitter(); // 清空所有监听
    this._rejectPendingInpatientEmrRequests(new Error('MedHermes SDK 已销毁'));
    this._rejectPendingOutpatientEmrRequests(new Error('MedHermes SDK 已销毁'));
    this._connected = false;
    this._transport = 'idle';
  };

  // 公卫使用独立握手、所有权和socket。绝不进入门诊 normalize/dispatch/restore。
  function publicHealthError(code, message) {
    var err = new Error(message); err.code = code; return err;
  }
  function publicHealthUuid() {
    if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
      throw publicHealthError('SECURE_RANDOM_UNAVAILABLE', '公卫接入需要浏览器安全随机数能力');
    }
    var bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    var hex = Array.prototype.map.call(bytes, function (n) { return ('0' + n.toString(16)).slice(-2); }).join('');
    return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  }
  function publicHealthId(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
  var PUBLIC_HEALTH_IDENTITY = ['schemaVersion','originRequestId','capability','scene','patientId','businessRecordId','recordVersion'];
  function publicHealthMatches(left, right, extra) {
    return PUBLIC_HEALTH_IDENTITY.concat(extra || []).every(function (key) { return left[key] === right[key]; });
  }
  MedHermes.prototype._publicHealthState = function () {
    if (!this._publicHealth) {
      var options = this._opts.publicHealth || {};
      this._publicHealth = { instanceId: options.sdkInstanceId || publicHealthUuid(), session: null, socket: null, ready: false,
        timer: null, renewTimer: null, promise: null, lastEventId: '', reconnect: 0, requests: Object.create(null), writes: Object.create(null), seen: Object.create(null) };
    }
    return this._publicHealth;
  };
  MedHermes.prototype.initPublicHealth = function (extra) {
    var self = this;
    if (this._destroyed) return Promise.reject(publicHealthError('SDK_DESTROYED', 'SDK 已销毁'));
    if (typeof WebSocket === 'undefined') return Promise.reject(publicHealthError('WEBSOCKET_UNSUPPORTED', '公卫接入需要支持 WebSocket 的浏览器'));
    var ph;
    try { ph = this._publicHealthState(); } catch (err) { return Promise.reject(err); }
    if (!publicHealthId(ph.instanceId)) return Promise.reject(publicHealthError('INVALID_REQUEST', 'sdkInstanceId 必须为 UUID'));
    if (ph.ready && ph.session && Date.parse(ph.session.expiresAt) > Date.now()) return Promise.resolve(ph.session);
    if (ph.promise) return ph.promise;
    function acceptSession(response) {
      if (self._destroyed) throw publicHealthError('SDK_DESTROYED', 'SDK 已销毁');
      var result = response && response.publicHealth;
      if (!result || result.schemaVersion !== 'public-health.v1' || !publicHealthId(result.bridgeSessionId)
          || typeof result.publicHealthBridgeToken !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))) throw publicHealthError('INVALID_RESPONSE', '公卫握手响应无效');
      if (ph.session && ph.session.bridgeSessionId !== result.bridgeSessionId) throw publicHealthError('BRIDGE_OWNER_MISMATCH', '续期不能改变任务所属会话');
      ph.session = result;
      return result;
    }
    ph.promise = this._initConnection(extra, true).then(acceptSession).then(function (result) {
      // A retry with the previous token may recover an already-expired current token.
      // Obtain a fresh token once, without starting any business operation.
      if (Date.parse(result.expiresAt) <= Date.now()) return self._handshake(true).then(acceptSession);
      return result;
    }).then(function (result) {
      if (Date.parse(result.expiresAt) <= Date.now()) throw publicHealthError('BRIDGE_SESSION_EXPIRED', '公卫会话未获得有效续期');
      return self._subscribePublicHealth();
    }).then(function (result) { ph.promise = null; return result; }, function (err) { ph.promise = null; throw err; });
    return ph.promise;
  };
  MedHermes.prototype._subscribePublicHealth = function () {
    var self = this, ph = this._publicHealth;
    return new Promise(function (resolve, reject) {
      var acknowledged = false, retry = true;
      var ws = new WebSocket(buildEventWebSocketUrl(self._opts.baseUrl, '') + '?channel=public-health');
      ph.socket = ws;
      var timeout = setTimeout(function () { reject(publicHealthError('BRIDGE_AUTH_FAILED', '公卫订阅未完成认证')); try { ws.close(); } catch (_) {} }, 10000);
      ws.onopen = function () {
        if (self._destroyed || !ph.session) { try { ws.close(); } catch (_) {} return; }
        ws.send(JSON.stringify({ type:'public-health-subscribe', schemaVersion:'public-health.v1', bridgeSessionId:ph.session.bridgeSessionId,
          publicHealthBridgeToken:ph.session.publicHealthBridgeToken, after:ph.lastEventId || undefined }));
      };
      ws.onmessage = function (message) {
        if (self._destroyed || !ph.session || !message || typeof message.data !== 'string' || message.data === 'pong') return;
        var data; try { data = JSON.parse(message.data); } catch (_) { return; }
        if (data.type === 'public-health-error') {
          var err = publicHealthError(data.errorCode || 'BRIDGE_AUTH_FAILED', data.message || '公卫事件通道不可用');
          retry = ['BRIDGE_AUTH_FAILED','BRIDGE_OWNER_MISMATCH','ORIGIN_NOT_ALLOWED','BRIDGE_NOT_CONFIGURED','EVENT_CURSOR_INVALID'].indexOf(err.code) < 0;
          self._emitter.emit('public-health-error', err);
          if (!acknowledged) reject(err);
          return;
        }
        if (data.type === 'public-health-subscribed' && data.schemaVersion === 'public-health.v1' && data.bridgeSessionId === ph.session.bridgeSessionId) {
          if (acknowledged) return;
          acknowledged = true; clearTimeout(timeout); ph.ready = true; ph.reconnect = 0;
          // Proactively renew at expiry even when the host does not observe a close event.
          clearTimeout(ph.renewTimer);
          ph.renewTimer = setTimeout(function () { ph.ready = false; try { ws.close(); } catch (_) {} }, Math.max(1, Date.parse(ph.session.expiresAt) - Date.now()));
          self._emitter.emit('public-health-connected', { bridgeSessionId:ph.session.bridgeSessionId, expiresAt:ph.session.expiresAt });
          resolve(ph.session); return;
        }
        if (!acknowledged || data.state !== 'ready' || !data.event) return;
        self._dispatchPublicHealth(data.event);
      };
      ws.onerror = function () { if (!acknowledged) reject(publicHealthError('BRIDGE_CONNECTION_FAILED', '公卫事件通道连接失败')); };
      ws.onclose = function () {
        clearTimeout(timeout);
        if (ph.socket !== ws) return;
        clearTimeout(ph.renewTimer);
        ph.socket = null; ph.ready = false;
        if (!acknowledged) reject(publicHealthError('BRIDGE_CONNECTION_FAILED', '公卫事件通道已关闭'));
        if (!self._destroyed && retry) self._schedulePublicHealthReconnect();
      };
    });
  };
  MedHermes.prototype._schedulePublicHealthReconnect = function () {
    var self = this, ph = this._publicHealth;
    if (!ph || ph.timer || this._destroyed) return;
    var delay = Math.min(30000, 1000 * Math.pow(2, Math.min(ph.reconnect++, 5)));
    ph.timer = setTimeout(function () {
      ph.timer = null;
      self.initPublicHealth().catch(function (err) {
        self._emitter.emit('public-health-error', err);
        // Credential rejection cannot be repaired by acquiring another instance's session.
        if (err.status === 401 || err.status === 403 || ['BRIDGE_AUTH_FAILED','BRIDGE_OWNER_MISMATCH','ORIGIN_NOT_ALLOWED','BRIDGE_NOT_CONFIGURED','EVENT_CURSOR_INVALID'].indexOf(err.code) >= 0) return;
        self._schedulePublicHealthReconnect();
      });
    }, delay);
  };
  MedHermes.prototype._dispatchPublicHealth = function (event) {
    var ph = this._publicHealth, payload = event.payload || {};
    if (!ph || event.type !== 'public-health-result-confirmed' || event.bridgeSessionId !== ph.session.bridgeSessionId || !publicHealthId(event.id)) return;
    var request = ph.requests[payload.originRequestId];
    if (!request || !publicHealthMatches(request, payload) || !publicHealthId(payload.requestId) || !publicHealthId(payload.generationId) || !publicHealthId(payload.writebackRequestId)) return;
    if (!Array.isArray(payload.items) || !payload.items.length) return;
    var seenTargets = Object.create(null);
    var valid = payload.items.every(function (item) {
      var target = request.writebackTargets.filter(function (t) { return t.targetFieldId === item.targetFieldId; })[0];
      if (!target || seenTargets[item.targetFieldId] || JSON.stringify(target.sourceSections) !== JSON.stringify(item.sourceSections) || typeof item.value !== 'string' || !item.value.trim()) return false;
      seenTargets[item.targetFieldId] = true; return true;
    });
    if (!valid) return;
    if (ph.seen[event.id]) { ph.lastEventId = event.id; return; }
    var previous = ph.writes[payload.writebackRequestId];
    if (previous && JSON.stringify(previous) !== JSON.stringify(payload)) { this._emitter.emit('public-health-error', publicHealthError('WRITEBACK_ID_CONFLICT', '重复保存标识对应不同内容')); return; }
    ph.seen[event.id] = true; ph.lastEventId = event.id; ph.writes[payload.writebackRequestId] = JSON.parse(JSON.stringify(payload));
    this._emitter.emit('public-health-result-confirmed', payload);
  };
  MedHermes.prototype.assistPublicHealth = function (request) {
    var self = this;
    if (!isPlainObject(request) || !publicHealthId(request.requestId) || request.originRequestId !== request.requestId || !Array.isArray(request.writebackTargets)) return Promise.reject(publicHealthError('INVALID_REQUEST', '公卫首次调入需要匹配的 requestId/originRequestId 和字段映射'));
    var snapshot = JSON.parse(JSON.stringify(request));
    return this.initPublicHealth().then(function () {
      var ph = self._publicHealth, old = ph.requests[snapshot.originRequestId];
      if (old && JSON.stringify(old) !== JSON.stringify(snapshot)) throw publicHealthError('REQUEST_ID_CONFLICT', '同一调入标识对应不同资料');
      if (!old && Object.keys(ph.requests).length >= 128) throw publicHealthError('CAPACITY_EXCEEDED', '当前SDK实例公卫任务容量已满');
      ph.requests[snapshot.originRequestId] = snapshot;
      return self._http.post('/public-health/assist', snapshot, { 'X-PCIE-Bridge-Token':ph.session.publicHealthBridgeToken });
    });
  };
  MedHermes.prototype.sendPublicHealthFeedback = function (feedback) {
    var self = this, ph = this._publicHealth;
    var intent = ph && feedback && ph.writes[feedback.writebackRequestId];
    if (!intent || !publicHealthMatches(intent, feedback, ['requestId','generationId','writebackRequestId','snapshotAt']) || ['success','failed'].indexOf(feedback.status) < 0) return Promise.reject(publicHealthError('TASK_CONTEXT_MISMATCH', '回执未匹配本实例已收到的保存意图'));
    if (feedback.status === 'success' ? !feedback.savedRecordVersion || feedback.errorCode : !feedback.errorCode || !feedback.message || feedback.savedRecordVersion) return Promise.reject(publicHealthError('INVALID_REQUEST', '保存回执缺少终态信息'));
    var snapshot = JSON.parse(JSON.stringify(feedback));
    return this.initPublicHealth().then(function () { return self._http.post('/public-health/writeback-feedback', snapshot, { 'X-PCIE-Bridge-Token':ph.session.publicHealthBridgeToken }); });
  };
  MedHermes.prototype._destroyPublicHealth = function () {
    var ph = this._publicHealth;
    if (ph) { clearTimeout(ph.timer); clearTimeout(ph.renewTimer); if (ph.socket) { try { ph.socket.close(); } catch (_) {} } ph.session = null; ph.requests = {}; ph.writes = {}; this._publicHealth = null; }
    if (this._opts.publicHealth) this._opts.publicHealth = {};
  };

  // ─── 内部方法 ───

  MedHermes.prototype._waitForInpatientEmrWriteback = function (payload, acceptedResponse) {
    var self = this;
    return new Promise(function (resolve, reject) {
      self._pendingInpatientEmrRequests.push({
        admissionId: stringValue(payload.admissionId),
        requestId: stringValue(payload.requestId),
        acceptedResponse: acceptedResponse,
        resolve: resolve,
        reject: reject
      });
    });
  };

  MedHermes.prototype._resolvePendingInpatientEmrRequests = function (record, event) {
    if (!this._pendingInpatientEmrRequests.length || !isInpatientEmrConfirmedRecord(record)) return;
    var remaining = [];
    for (var i = 0; i < this._pendingInpatientEmrRequests.length; i++) {
      var pending = this._pendingInpatientEmrRequests[i];
      if (matchesInpatientEmrPending(pending, record, event)) {
        pending.resolve(record);
      } else {
        remaining.push(pending);
      }
    }
    this._pendingInpatientEmrRequests = remaining;
  };

  MedHermes.prototype._rejectPendingInpatientEmrRequests = function (error) {
    var pending = this._pendingInpatientEmrRequests || [];
    this._pendingInpatientEmrRequests = [];
    for (var i = 0; i < pending.length; i++) {
      pending[i].reject(error);
    }
  };

  MedHermes.prototype._waitForOutpatientEmrWriteback = function (payload, sendRequest) {
    var self = this;
    var pending;
    var promise = new Promise(function (resolve, reject) {
      pending = {
        visitId: stringValue(payload.visitId),
        requestId: stringValue(payload.requestId),
        templateId: stringValue(payload.templateId),
        templateName: stringValue(payload.templateName),
        requestSnapshotKey: getOutpatientEmrRequestSnapshotKey(payload),
        active: true,
        resolve: resolve,
        reject: reject
      };
      self._pendingOutpatientEmrRequests.push(pending);

      var acceptedRequest;
      try {
        acceptedRequest = sendRequest();
      } catch (error) {
        pending.active = false;
        self._removePendingOutpatientEmrRequest(pending);
        reject(error);
        return;
      }

      Promise.resolve(acceptedRequest).then(function () {
        if (!pending.active) return;
        self._resumeEventChannelIfNeeded();
      }, function (error) {
        if (!pending.active) return;
        pending.active = false;
        self._removePendingOutpatientEmrRequest(pending);
        reject(error);
      });
    });
    pending.promise = promise;
    return promise;
  };

  MedHermes.prototype._findActiveOutpatientEmrRequest = function (payload) {
    for (var i = 0; i < this._pendingOutpatientEmrRequests.length; i++) {
      var pending = this._pendingOutpatientEmrRequests[i];
      if (
        pending.active
        && matchesOutpatientEmrRequestSnapshot(pending, payload)
      ) {
        return pending;
      }
    }
    return null;
  };

  MedHermes.prototype._hasOutpatientEmrRequestIdConflict = function (payload) {
    var requestId = stringValue(payload.requestId);
    for (var i = 0; i < this._pendingOutpatientEmrRequests.length; i++) {
      var pending = this._pendingOutpatientEmrRequests[i];
      if (
        pending.active
        && pending.requestId === requestId
        && !matchesOutpatientEmrRequestSnapshot(pending, payload)
      ) {
        return true;
      }
    }
    return false;
  };

  MedHermes.prototype._rejectReplacedOutpatientEmrRequests = function (payload) {
    var remaining = [];
    for (var i = 0; i < this._pendingOutpatientEmrRequests.length; i++) {
      var pending = this._pendingOutpatientEmrRequests[i];
      var isSameIdentity = matchesOutpatientEmrRequestSnapshot(pending, payload);
      if (pending.active && !isSameIdentity) {
        pending.active = false;
        pending.reject(new Error('已被新的门诊模板分析请求替换'));
      } else {
        remaining.push(pending);
      }
    }
    this._pendingOutpatientEmrRequests = remaining;
  };

  MedHermes.prototype._removePendingOutpatientEmrRequest = function (target) {
    var remaining = [];
    for (var i = 0; i < this._pendingOutpatientEmrRequests.length; i++) {
      if (this._pendingOutpatientEmrRequests[i] !== target) {
        remaining.push(this._pendingOutpatientEmrRequests[i]);
      }
    }
    this._pendingOutpatientEmrRequests = remaining;
  };

  MedHermes.prototype._resolvePendingOutpatientEmrRequests = function (record) {
    if (!this._pendingOutpatientEmrRequests.length || !isOutpatientEmrConfirmedRecord(record)) return;
    var remaining = [];
    for (var i = 0; i < this._pendingOutpatientEmrRequests.length; i++) {
      var pending = this._pendingOutpatientEmrRequests[i];
      if (pending.active && matchesOutpatientEmrPending(pending, record)) {
        pending.active = false;
        if (isCompleteOutpatientEmrConfirmedRecord(record, pending)) {
          pending.resolve(record);
        } else {
          var error = new Error('INVALID_OUTPATIENT_EMR_RESULT: 门诊模板回参不符合当前协议');
          error.code = 'INVALID_OUTPATIENT_EMR_RESULT';
          pending.reject(error);
        }
      } else {
        remaining.push(pending);
      }
    }
    this._pendingOutpatientEmrRequests = remaining;
  };

  MedHermes.prototype._rejectPendingOutpatientEmrRequests = function (error) {
    var pending = this._pendingOutpatientEmrRequests || [];
    this._pendingOutpatientEmrRequests = [];
    for (var i = 0; i < pending.length; i++) {
      if (pending[i].active === false) continue;
      pending[i].active = false;
      pending[i].reject(error);
    }
  };

  MedHermes.prototype._rejectCancelledOutpatientEmrRequests = function (record) {
    if (
      !this._pendingOutpatientEmrRequests.length
      || !isOutpatientEmrCancelledRecord(record)
    ) return;
    var remaining = [];
    for (var i = 0; i < this._pendingOutpatientEmrRequests.length; i++) {
      var pending = this._pendingOutpatientEmrRequests[i];
      if (pending.active && matchesOutpatientEmrCancellation(pending, record)) {
        pending.active = false;
        pending.reject(new Error('门诊模板分析已取消'));
      } else {
        remaining.push(pending);
      }
    }
    this._pendingOutpatientEmrRequests = remaining;
  };

  /** HTTP 调用 + 离线协议拉起兜底 */
  MedHermes.prototype._callWithFallback = function (httpCall, protocolPath, params) {
    var self = this;
    
    // 静默执行一次握手，确保小球端上下文（如 Token）是最新的，以应对小球可能刚刚重启的情况。
    // 如果握手失败，我们忽略异常（catch），继续走后面的请求和兜底逻辑。
    var ensureHandshake = this._handshake().then(function(result) {
      self._connected = true;
      self._isChannelPersistent = true;
      self._lastHandshakeResult = result;
      self._ensureInteractionChannel(true);
      return result;
    }).catch(function() {
      if (!self._ws) {
        self._markDisconnected();
        self._scheduleWebSocketReconnect();
      }
    });

    return ensureHandshake.then(function() {
      return httpCall().catch(function (err) {
        // 网络失败（桌面端可能不在线），尝试协议拉起
        if (err.message === 'Request timeout' || err.message === 'Failed to fetch' || !err.status) {
          self._emitter.emit('launching');
          self._launcher.launch(protocolPath, params);

          return new Promise(function (resolve, reject) {
            setTimeout(function () {
              // 拉起后重试前，同样先做一次静默握手
              self._handshake().then(function(result) {
                self._connected = true;
                self._isChannelPersistent = true;
                self._lastHandshakeResult = result;
                self._ensureInteractionChannel(true);
                return result;
              }).catch(function() {}).then(function() {
                httpCall()
                  .then(resolve)
                  .catch(function () {
                    var offlineErr = new Error('全医慧助（PCIE）桌面端未启动');
                    offlineErr.code = 'OFFLINE';
                    self._emitter.emit('launch-failed');
                    self._emitter.emit('error', offlineErr);
                    reject(offlineErr);
                  });
              });
            }, self._opts.launchRetryMs);
          });
        }
        if (err.status === 401) {
          return self._handshake().then(function(result) {
            self._connected = true;
            self._isChannelPersistent = true;
            self._lastHandshakeResult = result;
            self._ensureInteractionChannel(true);
            return httpCall();
          }).catch(function(refreshErr) {
            self._emitter.emit('error', refreshErr);
            throw err;
          });
        }
        // 其他 HTTP 错误直接抛出
        self._emitter.emit('error', err);
        throw err;
      });
    });
  };

  /** 处理 WebSocket 事件：去重 + 分发事件 */
  MedHermes.prototype._dispatchEnvelope = function (envelope) {
    if (!envelope || !envelope.event) return;

    // 患者校验
    var consultationId = String(envelope.event.consultationId || '');
    var currentPatientId = String(this._currentPatientId || '');
    var currentConsultationId = String(this._currentConsultationId || '');
    if (
      consultationId
      && currentPatientId
      && currentConsultationId
      && consultationId !== currentPatientId
      && consultationId !== currentConsultationId
    ) {
      return; // 忽略非当前患者/就诊的结果
    }
    if (
      consultationId
      && currentPatientId
      && !currentConsultationId
      && consultationId !== currentPatientId
    ) {
      return; // 忽略非当前患者的结果
    }

    // 去重
    var key = buildEventKey(envelope);
    if (key === this._lastResultKey) return;
    this._lastResultKey = key;

    var event = envelope.event;
    var record = event.payload || {};
    var resultType = event.type || record.resultType || 'final-report';

    var outpatientResultType = record.resultType || resultType;
    var malformedOutpatientEvent = record.emrType === 'outpatient-emr'
      && (
        (outpatientResultType === 'record-confirmed'
          && !isCompleteOutpatientEmrConfirmedRecord(record, null))
        || (outpatientResultType === 'cancelled'
          && !isOutpatientEmrCancelledRecord(record))
      );

    // 分发通用 envelope 事件 + 按业务类型分发 payload
    this._lastEventId = event.id || '';
    this._lastEventConsultationId = consultationId || this._lastEventConsultationId;
    if (!malformedOutpatientEvent) {
      this._emitter.emit('event', envelope);
      this._emitter.emit(resultType, record);
    }
    this._resolvePendingInpatientEmrRequests(record, event);
    this._resolvePendingOutpatientEmrRequests(record);
    this._rejectCancelledOutpatientEmrRequests(record);
    if (malformedOutpatientEvent) {
      var protocolError = new Error(
        'INVALID_OUTPATIENT_EMR_RESULT: 门诊模板回参不符合当前协议'
      );
      protocolError.code = 'INVALID_OUTPATIENT_EMR_RESULT';
      this._emitter.emit('error', protocolError);
    }

  };

  // 暴露版本号
  MedHermes.VERSION = SDK_VERSION;

  function ensureFallbackLoader() {
    var host = typeof globalThis !== 'undefined'
      ? globalThis
      : (typeof window !== 'undefined' ? window : null);
    if (!host || host.MedHermesLoader) return;

    var loaderState = {
      instance: null,
      initPromise: null,
      readyCallbacks: [],
      errorCallbacks: []
    };

    function getInstance() {
      if (!loaderState.instance) {
        loaderState.instance = new MedHermes();
      }
      return loaderState.instance;
    }

    function fireReady(instance) {
      var callbacks = loaderState.readyCallbacks.slice();
      loaderState.readyCallbacks.length = 0;
      for (var i = 0; i < callbacks.length; i++) {
        try { callbacks[i](instance); } catch (e) { console.error(e); }
      }
    }

    function fireError(err) {
      for (var i = 0; i < loaderState.errorCallbacks.length; i++) {
        try { loaderState.errorCallbacks[i](err); } catch (e) { console.error(e); }
      }
    }

    function ensureReady(extra) {
      var instance = getInstance();
      if (loaderState.initPromise) return loaderState.initPromise;

      loaderState.initPromise = instance.init(extra)
        .catch(function (err) {
          fireError(err);
          return instance;
        })
        .then(function () {
          fireReady(instance);
          return instance;
        });
      return loaderState.initPromise;
    }

    function call(method, args) {
      return ensureReady().then(function (instance) {
        if (!instance || typeof instance[method] !== 'function') {
          throw new Error('MedHermes method not found: ' + method);
        }
        return instance[method].apply(instance, args || []);
      });
    }

    host.MedHermesLoader = {
      ready: function (fn) {
        if (loaderState.instance && loaderState.initPromise) {
          loaderState.initPromise.then(function (instance) {
            try { fn(instance); } catch (e) { console.error(e); }
          });
          return;
        }
        loaderState.readyCallbacks.push(fn);
        ensureReady();
      },
      onError: function (fn) {
        loaderState.errorCallbacks.push(fn);
      },
      getStatus: function () {
        return {
          online: !!(loaderState.instance && loaderState.instance._connected),
          sdkLoaded: true,
          instance: loaderState.instance
        };
      },
      ping: function () {
        return getInstance().ping();
      },
      detect: function () {
        return getInstance().ping()
          .then(function () { return true; })
          .catch(function () { return false; });
      },
      launch: function () {
        return getInstance()._launcher.launch('launch');
      },
      init: function (extra) {
        loaderState.initPromise = null;
        return ensureReady(extra);
      },
      startConsultation: function (patient) {
        return call('startConsultation', [patient]);
      },
      assist: function (patient, action) {
        return call('assist', [patient, action]);
      },
      startVoice: function (patient) {
        return call('startVoice', [patient]);
      },
      interpretReport: function () {
        return call('interpretReport', Array.prototype.slice.call(arguments));
      },
      generateInpatientEmr: function () {
        return call('generateInpatientEmr', Array.prototype.slice.call(arguments));
      },
      analyzeOutpatientEmr: function (request) {
        return call('analyzeOutpatientEmr', [request]);
      },
      receivePatient: function (patientId, optionalInfo) {
        return call('receivePatient', [patientId, optionalInfo]);
      },
      sendRisks: function (patient, risks) {
        return call('sendRisks', [patient, risks]);
      },
      sendFeedback: function (requestId, status, message, items) {
        return call('sendFeedback', [requestId, status, message, items]);
      },
      stop: function () {
        return call('stop', []);
      }
    };
  }

  ensureFallbackLoader();

  return MedHermes;
});
