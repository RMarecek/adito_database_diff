import { db, util } from "@aditosoftware/jdito-types";

var GET_ACTIONS = ["health", "db_info", "ddl_execution_status", "ddl_execution_logs"];
var POST_ACTIONS = ["metadata_export", "ddl_validate", "ddl_execute"];
var ALL_ACTIONS = GET_ACTIONS.concat(POST_ACTIONS);
var STEP_ACTIONS = [
    "CREATE_TABLE",
    "DROP_TABLE",
    "ADD_COLUMN",
    "DROP_COLUMN",
    "ALTER_COLUMN",
    "RENAME_TABLE",
    "RENAME_COLUMN",
    "CREATE_INDEX",
    "DROP_INDEX"
];

var LOCKING_BY_ACTION = {
    CREATE_TABLE: "LOW",
    DROP_TABLE: "HIGH",
    ADD_COLUMN: "MEDIUM",
    DROP_COLUMN: "HIGH",
    ALTER_COLUMN: "HIGH",
    RENAME_TABLE: "MEDIUM",
    RENAME_COLUMN: "MEDIUM",
    CREATE_INDEX: "MEDIUM",
    DROP_INDEX: "MEDIUM"
};

var EXECUTION_STORE = {};
var METADATA_CACHE = { columns: {}, indexes: {} };
var METADATA_DEFAULT_CACHE_TTL_MS = 120000;
var UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function restget(pRequest) // eslint-disable-line no-unused-vars -- called by adito kernel
{
    return _handleRequest(pRequest, "GET");
}

function restpost(pRequest) // eslint-disable-line no-unused-vars -- called by adito kernel
{
    return _handleRequest(pRequest, "POST");
}

function _handleRequest(pRequest, pMethod)
{
    var parseResult = _parseRequest(pRequest);
    var request = parseResult.ok ? parseResult.value : {
        query: {},
        header: {},
        response: { header: {} }
    };

    _ensureRequestShape(request);

    var correlationId = _ensureCorrelationId(request);
    _setCommonResponseHeaders(request, correlationId);

    if (!parseResult.ok)
    {
        return _writeErrorResponse(
            request,
            400,
            correlationId,
            "INVALID_ARGUMENT",
            "Request must be a valid JSON object.",
            { reason: parseResult.error }
        );
    }

    var action = _toLower(_getQueryValue(request, "action"));
    if (!_isNonEmptyString(action))
    {
        return _writeErrorResponse(
            request,
            400,
            correlationId,
            "INVALID_ARGUMENT",
            "Missing required query parameter 'action'.",
            {}
        );
    }

    if (!_contains(ALL_ACTIONS, action))
    {
        return _writeErrorResponse(
            request,
            400,
            correlationId,
            "INVALID_ARGUMENT",
            "Unknown action '" + action + "'.",
            { allowedActions: ALL_ACTIONS }
        );
    }

    var expectedMethod = _expectedMethodForAction(action);
    if (expectedMethod !== pMethod)
    {
        return _writeErrorResponse(
            request,
            400,
            correlationId,
            "INVALID_ARGUMENT",
            "Action '" + action + "' must be called with " + expectedMethod + ".",
            { expectedMethod: expectedMethod, receivedMethod: pMethod }
        );
    }

    try
    {
        switch (action)
        {
            case "health":
                return _handleHealth(request, correlationId);
            case "db_info":
                return _handleDbInfo(request, correlationId);
            case "metadata_export":
                return _handleMetadataExport(request, correlationId);
            case "ddl_validate":
                return _handleDdlValidate(request, correlationId);
            case "ddl_execute":
                return _handleDdlExecute(request, correlationId);
            case "ddl_execution_status":
                return _handleDdlExecutionStatus(request, correlationId);
            case "ddl_execution_logs":
                return _handleDdlExecutionLogs(request, correlationId);
            default:
                return _writeErrorResponse(
                    request,
                    400,
                    correlationId,
                    "INVALID_ARGUMENT",
                    "Unknown action '" + action + "'.",
                    { allowedActions: ALL_ACTIONS }
                );
        }
    }
    catch (ex)
    {
        return _writeErrorResponse(
            request,
            500,
            correlationId,
            "INTERNAL_ERROR",
            "Unexpected server error.",
            { reason: (ex && ex.message) ? ex.message : String(ex) }
        );
    }
}

function _handleHealth(pRequest, pCorrelationId)
{
    return _writeJsonResponse(pRequest, 200, pCorrelationId, {
        correlationId: pCorrelationId,
        status: "ok",
        service: "crm-db-gateway",
        version: "1.0.0",
        time: _nowIso()
    });
}

function _handleDbInfo(pRequest, pCorrelationId)
{
    var dbCtx = _getDbContext(pRequest);
    return _writeJsonResponse(pRequest, 200, pCorrelationId, {
        correlationId: pCorrelationId,
        db: {
            type: dbCtx.dbType,
            version: dbCtx.dbVersion,
            defaultSchema: dbCtx.defaultSchema
        }
    });
}

function _handleMetadataExport(pRequest, pCorrelationId)
{
    var bodyResult = _parseRequestBody(pRequest);
    if (!bodyResult.ok)
    {
        return _writeErrorResponse(
            pRequest,
            400,
            pCorrelationId,
            "INVALID_ARGUMENT",
            "Body must be valid JSON.",
            { reason: bodyResult.error }
        );
    }

    var payload = bodyResult.value || {};
    var payloadErrors = _validateMetadataExportPayload(payload);
    if (payloadErrors.length > 0)
    {
        return _writeErrorResponse(
            pRequest,
            400,
            pCorrelationId,
            "INVALID_ARGUMENT",
            "Invalid metadata_export payload.",
            { validationErrors: payloadErrors }
        );
    }

    var dbCtx = _getDbContext(pRequest);
    var metadataResult = _loadMetadataFromDatabase(dbCtx, payload);
    if (!metadataResult.ok)
    {
        return _writeErrorResponse(
            pRequest,
            metadataResult.statusCode,
            pCorrelationId,
            metadataResult.errorCode,
            metadataResult.message,
            metadataResult.details
        );
    }

    return _writeJsonResponse(pRequest, 200, pCorrelationId, {
        correlationId: pCorrelationId,
        db: {
            type: dbCtx.dbType,
            version: dbCtx.dbVersion
        },
        generatedAt: _nowIso(),
        page: metadataResult.page,
        tables: metadataResult.tables,
        columns: metadataResult.columns,
        indexes: metadataResult.indexes
    });
}

function _handleDdlValidate(pRequest, pCorrelationId)
{
    var bodyResult = _parseRequestBody(pRequest);
    if (!bodyResult.ok)
    {
        return _writeErrorResponse(
            pRequest,
            400,
            pCorrelationId,
            "INVALID_ARGUMENT",
            "Body must be valid JSON.",
            { reason: bodyResult.error }
        );
    }

    var payload = bodyResult.value || {};
    var payloadErrors = _validateDdlValidatePayload(payload);
    if (payloadErrors.length > 0)
    {
        return _writeErrorResponse(
            pRequest,
            400,
            pCorrelationId,
            "INVALID_ARGUMENT",
            "Invalid ddl_validate payload.",
            { validationErrors: payloadErrors }
        );
    }

    var dbCtx = _getDbContext(pRequest);
    var strict = _readBoolean(payload.options && payload.options.strict, true);
    var returnSqlPreview = _readBoolean(payload.options && payload.options.returnSqlPreview, true);
    var steps = payload.steps || [];
    var results = [];

    for (var i = 0; i < steps.length; i++)
    {
        var step = steps[i];
        var stepId = _isNonEmptyString(step && step.stepId) ? step.stepId : _generateUuidV4();
        var validation = _validateChangeStep(step, strict, dbCtx.dbType);
        var sqlPreview = [];

        if (validation.valid)
        {
            var dbValidation = _validateStepAgainstDatabase(step, dbCtx, strict);
            if (dbValidation.blockingIssues.length > 0)
            {
                validation.valid = false;
                validation.blockingIssues = validation.blockingIssues.concat(dbValidation.blockingIssues);
            }
            if (dbValidation.warnings.length > 0)
            {
                validation.warnings = validation.warnings.concat(dbValidation.warnings);
            }
        }

        if (validation.valid && returnSqlPreview)
        {
            var sqlResult = _generateSqlForStep(step, dbCtx.dbType);
            if (sqlResult.ok)
            {
                sqlPreview = sqlResult.sql;
            }
            else
            {
                validation.valid = false;
                validation.blockingIssues.push(sqlResult.error);
            }
        }

        results.push({
            stepId: stepId,
            valid: validation.valid,
            blockingIssues: validation.blockingIssues,
            warnings: validation.warnings,
            sqlPreview: sqlPreview,
            estimatedLocking: _estimateLocking(step && step.action)
        });
    }

    var allValid = true;
    for (var j = 0; j < results.length; j++)
    {
        if (!results[j].valid)
        {
            allValid = false;
            break;
        }
    }

    // Validate only; this handler intentionally does not execute any DDL.
    return _writeJsonResponse(pRequest, 200, pCorrelationId, {
        correlationId: pCorrelationId,
        db: {
            type: dbCtx.dbType,
            version: dbCtx.dbVersion
        },
        valid: allValid,
        results: results
    });
}

function _handleDdlExecute(pRequest, pCorrelationId)
{
    var bodyResult = _parseRequestBody(pRequest);
    if (!bodyResult.ok)
    {
        return _writeErrorResponse(
            pRequest,
            400,
            pCorrelationId,
            "INVALID_ARGUMENT",
            "Body must be valid JSON.",
            { reason: bodyResult.error }
        );
    }

    var payload = bodyResult.value || {};
    var payloadErrors = _validateDdlExecutePayload(payload);
    if (payloadErrors.length > 0)
    {
        return _writeErrorResponse(
            pRequest,
            400,
            pCorrelationId,
            "INVALID_ARGUMENT",
            "Invalid ddl_execute payload.",
            { validationErrors: payloadErrors }
        );
    }

    var dbCtx = _getDbContext(pRequest);
    var strict = true;
    var stepValidationErrors = [];
    var steps = payload.steps || [];

    for (var i = 0; i < steps.length; i++)
    {
        var validation = _validateChangeStep(steps[i], strict, dbCtx.dbType);
        if (validation.valid)
        {
            var dbValidation = _validateStepAgainstDatabase(steps[i], dbCtx, strict);
            if (dbValidation.blockingIssues.length > 0)
            {
                validation.valid = false;
                validation.blockingIssues = validation.blockingIssues.concat(dbValidation.blockingIssues);
            }
        }

        if (!validation.valid)
        {
            stepValidationErrors.push({
                stepId: steps[i] && steps[i].stepId ? steps[i].stepId : null,
                blockingIssues: validation.blockingIssues
            });
        }
    }

    if (stepValidationErrors.length > 0)
    {
        return _writeErrorResponse(
            pRequest,
            400,
            pCorrelationId,
            "INVALID_ARGUMENT",
            "One or more steps are invalid and cannot be executed.",
            { stepErrors: stepValidationErrors }
        );
    }

    var executionId = _generateUuidV4();
    var submittedAt = _nowIso();
    var stepResults = [];
    for (var stepIndex = 0; stepIndex < steps.length; stepIndex++)
    {
        stepResults.push({
            stepId: steps[stepIndex].stepId,
            status: "QUEUED",
            startedAt: null,
            endedAt: null,
            sqlExecuted: [],
            error: null
        });
    }

    EXECUTION_STORE[executionId] = {
        executionId: executionId,
        dbType: dbCtx.dbType,
        dbAlias: dbCtx.alias,
        dbVersion: dbCtx.dbVersion,
        schema: payload.schema,
        submittedAt: submittedAt,
        startedAt: null,
        endedAt: null,
        status: "QUEUED",
        steps: steps,
        stepResults: stepResults,
        options: payload.options || {},
        logs: [
            {
                time: submittedAt,
                level: "INFO",
                message: "Execution queued"
            }
        ]
    };

    // Async placeholder: execute immediately in-process and expose result via polling endpoints.
    while (EXECUTION_STORE[executionId].status === "QUEUED" || EXECUTION_STORE[executionId].status === "RUNNING")
    {
        _advanceExecutionState(EXECUTION_STORE[executionId]);
    }

    return _writeJsonResponse(pRequest, 202, pCorrelationId, {
        correlationId: pCorrelationId,
        executionId: executionId,
        status: "QUEUED",
        submittedAt: submittedAt
    });
}

function _handleDdlExecutionStatus(pRequest, pCorrelationId)
{
    var executionId = _getQueryValue(pRequest, "executionId");
    if (!_isNonEmptyString(executionId))
    {
        return _writeErrorResponse(
            pRequest,
            400,
            pCorrelationId,
            "INVALID_ARGUMENT",
            "Missing required query parameter 'executionId'.",
            {}
        );
    }

    if (!_isUuidV4(executionId))
    {
        return _writeErrorResponse(
            pRequest,
            400,
            pCorrelationId,
            "INVALID_ARGUMENT",
            "executionId must be a UUIDv4 string.",
            { executionId: executionId }
        );
    }

    var execution = EXECUTION_STORE[executionId];
    if (!execution)
    {
        return _writeErrorResponse(
            pRequest,
            404,
            pCorrelationId,
            "EXECUTION_NOT_FOUND",
            "Execution not found.",
            { executionId: executionId }
        );
    }

    _advanceExecutionState(execution);

    return _writeJsonResponse(pRequest, 200, pCorrelationId, {
        correlationId: pCorrelationId,
        executionId: execution.executionId,
        status: execution.status,
        submittedAt: execution.submittedAt,
        startedAt: execution.startedAt,
        endedAt: execution.endedAt,
        stepResults: execution.stepResults
    });
}

function _handleDdlExecutionLogs(pRequest, pCorrelationId)
{
    var executionId = _getQueryValue(pRequest, "executionId");
    if (!_isNonEmptyString(executionId))
    {
        return _writeErrorResponse(
            pRequest,
            400,
            pCorrelationId,
            "INVALID_ARGUMENT",
            "Missing required query parameter 'executionId'.",
            {}
        );
    }

    if (!_isUuidV4(executionId))
    {
        return _writeErrorResponse(
            pRequest,
            400,
            pCorrelationId,
            "INVALID_ARGUMENT",
            "executionId must be a UUIDv4 string.",
            { executionId: executionId }
        );
    }

    var after = _getQueryValue(pRequest, "after");
    var afterMs = null;
    if (_isNonEmptyString(after))
    {
        afterMs = Date.parse(after);
        if (isNaN(afterMs))
        {
            return _writeErrorResponse(
                pRequest,
                400,
                pCorrelationId,
                "INVALID_ARGUMENT",
                "Parameter 'after' must be an ISO 8601 timestamp.",
                { after: after }
            );
        }
    }

    var execution = EXECUTION_STORE[executionId];
    if (!execution)
    {
        return _writeErrorResponse(
            pRequest,
            404,
            pCorrelationId,
            "EXECUTION_NOT_FOUND",
            "Execution not found.",
            { executionId: executionId }
        );
    }

    _advanceExecutionState(execution);

    var items = [];
    for (var i = 0; i < execution.logs.length; i++)
    {
        var itemTimeMs = Date.parse(execution.logs[i].time);
        if (afterMs == null || (isNaN(itemTimeMs) ? true : itemTimeMs > afterMs))
        {
            items.push(execution.logs[i]);
        }
    }

    return _writeJsonResponse(pRequest, 200, pCorrelationId, {
        correlationId: pCorrelationId,
        executionId: execution.executionId,
        items: items
    });
}

function _advanceExecutionState(pExecution)
{
    if (pExecution.status === "SUCCEEDED" || pExecution.status === "FAILED")
    {
        return;
    }

    if (pExecution.status === "QUEUED")
    {
        pExecution.status = "RUNNING";
        pExecution.startedAt = _nowIso();
        pExecution.logs.push({
            time: pExecution.startedAt,
            level: "INFO",
            message: "Execution started"
        });
    }

    var pendingIndex = -1;
    for (var i = 0; i < pExecution.stepResults.length; i++)
    {
        if (pExecution.stepResults[i].status === "QUEUED")
        {
            pendingIndex = i;
            break;
        }
    }

    if (pendingIndex === -1)
    {
        pExecution.status = "SUCCEEDED";
        if (!pExecution.endedAt)
        {
            pExecution.endedAt = _nowIso();
            pExecution.logs.push({
                time: pExecution.endedAt,
                level: "INFO",
                message: "Execution completed"
            });
        }
        return;
    }

    var step = pExecution.steps[pendingIndex];
    var stepResult = pExecution.stepResults[pendingIndex];

    stepResult.status = "RUNNING";
    stepResult.startedAt = _nowIso();
    pExecution.logs.push({
        time: stepResult.startedAt,
        level: "INFO",
        message: "Step " + step.action + " started"
    });

    var sqlResult = _generateSqlForStep(step, pExecution.dbType);
    if (!sqlResult.ok)
    {
        stepResult.status = "FAILED";
        stepResult.endedAt = _nowIso();
        stepResult.sqlExecuted = [];
        stepResult.error = {
            code: "STEP_SQL_GENERATION_FAILED",
            message: sqlResult.error,
            details: {}
        };
        pExecution.status = "FAILED";
        pExecution.endedAt = stepResult.endedAt;
        pExecution.logs.push({
            time: stepResult.endedAt,
            level: "ERROR",
            message: "Step " + step.action + " failed: " + sqlResult.error
        });
        return;
    }

    try
    {
        for (var sqlIndex = 0; sqlIndex < sqlResult.sql.length; sqlIndex++)
        {
            db.runStatement(sqlResult.sql[sqlIndex], pExecution.dbAlias);
        }

        stepResult.status = "SUCCEEDED";
        stepResult.endedAt = _nowIso();
        stepResult.sqlExecuted = sqlResult.sql.slice();
        stepResult.error = null;
        pExecution.logs.push({
            time: stepResult.endedAt,
            level: "INFO",
            message: "Step " + step.action + " succeeded"
        });
    }
    catch (ex)
    {
        stepResult.status = "FAILED";
        stepResult.endedAt = _nowIso();
        stepResult.sqlExecuted = [];
        stepResult.error = {
            code: "STEP_EXECUTION_FAILED",
            message: (ex && ex.message) ? ex.message : String(ex),
            details: {}
        };
        pExecution.logs.push({
            time: stepResult.endedAt,
            level: "ERROR",
            message: "Step " + step.action + " failed during execution"
        });

        var stopOnError = _readBoolean(pExecution.options && pExecution.options.stopOnError, true);
        if (stopOnError)
        {
            pExecution.status = "FAILED";
            pExecution.endedAt = stepResult.endedAt;
        }
        return;
    }

    var hasQueued = false;
    var hasRunning = false;
    var hasFailed = false;
    for (var resultIndex = 0; resultIndex < pExecution.stepResults.length; resultIndex++)
    {
        if (pExecution.stepResults[resultIndex].status === "QUEUED")
        {
            hasQueued = true;
        }
        else if (pExecution.stepResults[resultIndex].status === "RUNNING")
        {
            hasRunning = true;
        }
        else if (pExecution.stepResults[resultIndex].status === "FAILED")
        {
            hasFailed = true;
        }
    }

    if (!hasQueued && !hasRunning)
    {
        pExecution.status = hasFailed ? "FAILED" : "SUCCEEDED";
        pExecution.endedAt = _nowIso();
        pExecution.logs.push({
            time: pExecution.endedAt,
            level: hasFailed ? "ERROR" : "INFO",
            message: hasFailed ? "Execution completed with failures" : "Execution completed"
        });
    }
}

function _validateMetadataExportPayload(pPayload)
{
    var errors = [];

    if (!_isObject(pPayload))
    {
        errors.push("Payload must be an object.");
        return errors;
    }

    if (!_isNonEmptyString(pPayload.schema))
    {
        errors.push("schema is required and must be a non-empty string.");
    }

    if (_hasValue(pPayload.include) && !_isObject(pPayload.include))
    {
        errors.push("include must be an object when provided.");
    }
    else if (_isObject(pPayload.include))
    {
        if (_hasValue(pPayload.include.tables) && typeof pPayload.include.tables !== "boolean")
        {
            errors.push("include.tables must be boolean when provided.");
        }
        if (_hasValue(pPayload.include.columns) && typeof pPayload.include.columns !== "boolean")
        {
            errors.push("include.columns must be boolean when provided.");
        }
        if (_hasValue(pPayload.include.indexes) && typeof pPayload.include.indexes !== "boolean")
        {
            errors.push("include.indexes must be boolean when provided.");
        }
    }

    if (_hasValue(pPayload.options) && !_isObject(pPayload.options))
    {
        errors.push("options must be an object when provided.");
    }
    else if (_isObject(pPayload.options))
    {
        if (_hasValue(pPayload.options.detailLevel))
        {
            var detailLevel = _toLower(pPayload.options.detailLevel);
            if (detailLevel !== "fast" && detailLevel !== "full")
            {
                errors.push("options.detailLevel must be 'fast' or 'full' when provided.");
            }
        }
        if (_hasValue(pPayload.options.includeColumnDefaults) && typeof pPayload.options.includeColumnDefaults !== "boolean")
        {
            errors.push("options.includeColumnDefaults must be boolean when provided.");
        }
        if (_hasValue(pPayload.options.includeColumnComments) && typeof pPayload.options.includeColumnComments !== "boolean")
        {
            errors.push("options.includeColumnComments must be boolean when provided.");
        }
        if (_hasValue(pPayload.options.includeIndexExpressions) && typeof pPayload.options.includeIndexExpressions !== "boolean")
        {
            errors.push("options.includeIndexExpressions must be boolean when provided.");
        }
        if (_hasValue(pPayload.options.matchByTableNameOnly) && typeof pPayload.options.matchByTableNameOnly !== "boolean")
        {
            errors.push("options.matchByTableNameOnly must be boolean when provided.");
        }
        if (_hasValue(pPayload.options.comparisonSchema) && pPayload.options.comparisonSchema !== null && typeof pPayload.options.comparisonSchema !== "string")
        {
            errors.push("options.comparisonSchema must be string or null when provided.");
        }
        if (_hasValue(pPayload.options.useCache) && typeof pPayload.options.useCache !== "boolean")
        {
            errors.push("options.useCache must be boolean when provided.");
        }
        if (_hasValue(pPayload.options.cacheTtlSeconds))
        {
            var cacheTtl = _toPositiveInt(pPayload.options.cacheTtlSeconds, -1);
            if (cacheTtl <= 0)
            {
                errors.push("options.cacheTtlSeconds must be a positive integer when provided.");
            }
        }
        if (_hasValue(pPayload.options.maxObjectsPerPage))
        {
            var maxObjectsPerPage = _toPositiveInt(pPayload.options.maxObjectsPerPage, -1);
            if (maxObjectsPerPage <= 0 || maxObjectsPerPage > 200)
            {
                errors.push("options.maxObjectsPerPage must be a positive integer <= 200 when provided.");
            }
        }
    }

    if (_hasValue(pPayload.page) && !_isObject(pPayload.page))
    {
        errors.push("page must be an object when provided.");
    }
    else if (_isObject(pPayload.page))
    {
        if (_hasValue(pPayload.page.pageSize))
        {
            var parsedPageSize = _toPositiveInt(pPayload.page.pageSize, -1);
            if (parsedPageSize <= 0 || parsedPageSize > 1000)
            {
                errors.push("page.pageSize must be a positive integer <= 1000.");
            }
        }
        if (_hasValue(pPayload.page.pageToken) && pPayload.page.pageToken !== null && typeof pPayload.page.pageToken !== "string")
        {
            errors.push("page.pageToken must be string or null.");
        }
    }

    return errors;
}

function _validateDdlValidatePayload(pPayload)
{
    var errors = [];

    if (!_isObject(pPayload))
    {
        errors.push("Payload must be an object.");
        return errors;
    }

    if (!_isNonEmptyString(pPayload.schema))
    {
        errors.push("schema is required and must be a non-empty string.");
    }

    if (!Array.isArray(pPayload.steps))
    {
        errors.push("steps is required and must be an array.");
    }

    if (_hasValue(pPayload.options) && !_isObject(pPayload.options))
    {
        errors.push("options must be an object when provided.");
    }
    else if (_isObject(pPayload.options))
    {
        if (_hasValue(pPayload.options.returnSqlPreview) && typeof pPayload.options.returnSqlPreview !== "boolean")
        {
            errors.push("options.returnSqlPreview must be boolean when provided.");
        }
        if (_hasValue(pPayload.options.strict) && typeof pPayload.options.strict !== "boolean")
        {
            errors.push("options.strict must be boolean when provided.");
        }
    }

    return errors;
}

function _validateDdlExecutePayload(pPayload)
{
    var errors = [];

    if (!_isObject(pPayload))
    {
        errors.push("Payload must be an object.");
        return errors;
    }

    if (!_isUuidV4(pPayload.requestId))
    {
        errors.push("requestId is required and must be UUIDv4.");
    }

    if (!_isNonEmptyString(pPayload.schema))
    {
        errors.push("schema is required and must be a non-empty string.");
    }

    if (!_isObject(pPayload.changeSet))
    {
        errors.push("changeSet is required and must be an object.");
    }
    else
    {
        if (!_isUuidV4(pPayload.changeSet.id))
        {
            errors.push("changeSet.id is required and must be UUIDv4.");
        }
        if (!_isNonEmptyString(pPayload.changeSet.title))
        {
            errors.push("changeSet.title is required and must be a non-empty string.");
        }
    }

    if (!Array.isArray(pPayload.steps) || pPayload.steps.length === 0)
    {
        errors.push("steps is required and must be a non-empty array.");
    }

    if (_hasValue(pPayload.options) && !_isObject(pPayload.options))
    {
        errors.push("options must be an object when provided.");
    }
    else if (_isObject(pPayload.options))
    {
        if (_hasValue(pPayload.options.stopOnError) && typeof pPayload.options.stopOnError !== "boolean")
        {
            errors.push("options.stopOnError must be boolean when provided.");
        }
        if (_hasValue(pPayload.options.lockTimeoutSeconds))
        {
            var lockTimeout = _toPositiveInt(pPayload.options.lockTimeoutSeconds, -1);
            if (lockTimeout <= 0)
            {
                errors.push("options.lockTimeoutSeconds must be a positive integer when provided.");
            }
        }
    }

    return errors;
}

function _validateChangeStep(pStep, pStrict, pDbType)
{
    var issues = [];
    var warnings = [];

    if (!_isObject(pStep))
    {
        return {
            valid: false,
            blockingIssues: ["Step must be an object."],
            warnings: []
        };
    }

    if (!_isUuidV4(pStep.stepId))
    {
        issues.push("stepId is required and must be UUIDv4.");
    }

    if (!_contains(STEP_ACTIONS, pStep.action))
    {
        issues.push("action is required and must be one of: " + STEP_ACTIONS.join(", "));
    }

    if (!_isObject(pStep.target))
    {
        issues.push("target is required and must be an object.");
    }
    else
    {
        if (!_isNonEmptyString(pStep.target.schema))
        {
            issues.push("target.schema is required and must be a non-empty string.");
        }
        if (!_isNonEmptyString(pStep.target.table))
        {
            issues.push("target.table is required and must be a non-empty string.");
        }
    }

    var payloadKinds = [];
    if (_hasValue(pStep.table))
    {
        payloadKinds.push("table");
    }
    if (_hasValue(pStep.column))
    {
        payloadKinds.push("column");
    }
    if (_hasValue(pStep.index))
    {
        payloadKinds.push("index");
    }

    if (payloadKinds.length > 1)
    {
        issues.push("Ambiguous step payload. Use exactly one of table, column, index.");
    }

    var expectedPayload = null;
    switch (pStep.action)
    {
        case "CREATE_TABLE":
            expectedPayload = "table";
            if (!_isObject(pStep.table))
            {
                issues.push("CREATE_TABLE requires table object.");
            }
            else
            {
                if (!Array.isArray(pStep.table.columns) || pStep.table.columns.length === 0)
                {
                    issues.push("CREATE_TABLE requires table.columns with at least one column.");
                }
            }
            break;
        case "DROP_TABLE":
            expectedPayload = null;
            break;
        case "ADD_COLUMN":
            expectedPayload = "column";
            if (!_isObject(pStep.column) || !_isNonEmptyString(pStep.column.name))
            {
                issues.push("ADD_COLUMN requires column object with column.name.");
            }
            break;
        case "DROP_COLUMN":
            expectedPayload = "column";
            if (!_isObject(pStep.column) || !_isNonEmptyString(pStep.column.name))
            {
                issues.push("DROP_COLUMN requires column object with column.name.");
            }
            break;
        case "ALTER_COLUMN":
            expectedPayload = "column";
            if (!_isObject(pStep.column) || !_isNonEmptyString(pStep.column.name))
            {
                issues.push("ALTER_COLUMN requires column object with column.name.");
            }
            break;
        case "RENAME_TABLE":
            expectedPayload = null;
            if (!_isObject(pStep.options) || !_isNonEmptyString(pStep.options.newTableName))
            {
                issues.push("RENAME_TABLE requires options.newTableName.");
            }
            break;
        case "RENAME_COLUMN":
            expectedPayload = "column";
            if (!_isObject(pStep.column) || !_isNonEmptyString(pStep.column.name))
            {
                issues.push("RENAME_COLUMN requires column object with existing column.name.");
            }
            if (!_isObject(pStep.options) || !_isNonEmptyString(pStep.options.newColumnName))
            {
                issues.push("RENAME_COLUMN requires options.newColumnName.");
            }
            break;
        case "CREATE_INDEX":
            expectedPayload = "index";
            if (!_isObject(pStep.index) || !_isNonEmptyString(pStep.index.name))
            {
                issues.push("CREATE_INDEX requires index object with index.name.");
            }
            else if (!Array.isArray(pStep.index.columns) || pStep.index.columns.length === 0)
            {
                issues.push("CREATE_INDEX requires index.columns with at least one column.");
            }
            break;
        case "DROP_INDEX":
            expectedPayload = "index";
            if (!_isObject(pStep.index) || !_isNonEmptyString(pStep.index.name))
            {
                issues.push("DROP_INDEX requires index object with index.name.");
            }
            break;
    }

    if (expectedPayload == null && payloadKinds.length > 0)
    {
        issues.push("Action " + pStep.action + " does not allow table/column/index payload.");
    }

    if (expectedPayload != null && (payloadKinds.length !== 1 || payloadKinds[0] !== expectedPayload))
    {
        issues.push("Action " + pStep.action + " requires exactly '" + expectedPayload + "' payload.");
    }

    if (_isObject(pStep.options) && pStep.options.ifExists === true && pStep.options.ifNotExists === true)
    {
        issues.push("options.ifExists and options.ifNotExists cannot both be true.");
    }

    if (_isObject(pStep.index) && _isNonEmptyString(pStep.index.whereClause))
    {
        var whereClauseMsg = "Index whereClause is not supported for " + pDbType + " in this gateway.";
        if (pStrict)
        {
            issues.push(whereClauseMsg);
        }
        else
        {
            warnings.push(whereClauseMsg);
        }
    }

    if ((_isObject(pStep.column) && _isNonEmptyString(pStep.column.canonicalType) && pStep.column.canonicalType === "OTHER")
        && !_isNonEmptyString(pStep.column.nativeType))
    {
        var nativeTypeMsg = "canonicalType OTHER should provide nativeType.";
        if (pStrict)
        {
            issues.push(nativeTypeMsg);
        }
        else
        {
            warnings.push(nativeTypeMsg);
        }
    }

    return {
        valid: issues.length === 0,
        blockingIssues: issues,
        warnings: warnings
    };
}

function _generateSqlForStep(pStep, pDbType)
{
    if (!_isObject(pStep))
    {
        return { ok: false, error: "Step must be an object." };
    }

    var action = pStep.action;
    if (!_contains(STEP_ACTIONS, action))
    {
        return { ok: false, error: "Unsupported step action '" + action + "'." };
    }

    try
    {
        switch (action)
        {
            case "CREATE_TABLE":
                return { ok: true, sql: [_sqlCreateTable(pStep, pDbType)] };
            case "DROP_TABLE":
                return { ok: true, sql: [_sqlDropTable(pStep, pDbType)] };
            case "ADD_COLUMN":
                return { ok: true, sql: [_sqlAddColumn(pStep, pDbType)] };
            case "DROP_COLUMN":
                return { ok: true, sql: [_sqlDropColumn(pStep, pDbType)] };
            case "ALTER_COLUMN":
                return { ok: true, sql: [_sqlAlterColumn(pStep, pDbType)] };
            case "RENAME_TABLE":
                return { ok: true, sql: [_sqlRenameTable(pStep, pDbType)] };
            case "RENAME_COLUMN":
                return { ok: true, sql: [_sqlRenameColumn(pStep)] };
            case "CREATE_INDEX":
                return { ok: true, sql: [_sqlCreateIndex(pStep, pDbType)] };
            case "DROP_INDEX":
                return { ok: true, sql: [_sqlDropIndex(pStep, pDbType)] };
            default:
                return { ok: false, error: "Unsupported step action '" + action + "'." };
        }
    }
    catch (ex)
    {
        return {
            ok: false,
            error: (ex && ex.message) ? ex.message : String(ex)
        };
    }
}

function _sqlCreateTable(pStep, pDbType)
{
    var tableName = _qualifiedTable(pStep.target.schema, pStep.target.table);
    var columns = pStep.table.columns || [];
    var sqlColumns = [];
    for (var i = 0; i < columns.length; i++)
    {
        sqlColumns.push(_columnDefinition(columns[i], pDbType));
    }

    var createPrefix = "CREATE TABLE ";
    if (pDbType === "mariadb" && pStep.options && pStep.options.ifNotExists === true)
    {
        createPrefix = "CREATE TABLE IF NOT EXISTS ";
    }

    var sql = createPrefix + tableName + " (" + sqlColumns.join(", ") + ")";
    if (pDbType === "oracle")
    {
        var tablespace = pStep.table && pStep.table.storage && pStep.table.storage.tablespace;
        if (_isNonEmptyString(tablespace))
        {
            sql += " TABLESPACE " + _normalizeIdentifier(tablespace);
        }
    }
    else
    {
        var engine = pStep.table && pStep.table.storage && pStep.table.storage.engine;
        sql += " ENGINE=" + (_isNonEmptyString(engine) ? engine : "InnoDB");
    }

    return sql;
}

function _sqlDropTable(pStep, pDbType)
{
    var tableName = _qualifiedTable(pStep.target.schema, pStep.target.table);
    if (pDbType === "mariadb" && pStep.options && pStep.options.ifExists === true)
    {
        return "DROP TABLE IF EXISTS " + tableName;
    }
    return "DROP TABLE " + tableName;
}

function _sqlAddColumn(pStep, pDbType)
{
    var tableName = _qualifiedTable(pStep.target.schema, pStep.target.table);
    var columnSql = _columnDefinition(pStep.column, pDbType);
    if (pDbType === "oracle")
    {
        return "ALTER TABLE " + tableName + " ADD (" + columnSql + ")";
    }
    var addPrefix = "ADD COLUMN ";
    if (pStep.options && pStep.options.ifNotExists === true)
    {
        addPrefix = "ADD COLUMN IF NOT EXISTS ";
    }
    return "ALTER TABLE " + tableName + " " + addPrefix + columnSql;
}

function _sqlDropColumn(pStep, pDbType)
{
    var tableName = _qualifiedTable(pStep.target.schema, pStep.target.table);
    var columnName = _normalizeIdentifier(pStep.column.name);
    if (pDbType === "mariadb" && pStep.options && pStep.options.ifExists === true)
    {
        return "ALTER TABLE " + tableName + " DROP COLUMN IF EXISTS " + columnName;
    }
    return "ALTER TABLE " + tableName + " DROP COLUMN " + columnName;
}

function _sqlAlterColumn(pStep, pDbType)
{
    var tableName = _qualifiedTable(pStep.target.schema, pStep.target.table);
    var columnSql = _columnDefinition(pStep.column, pDbType);
    if (pDbType === "oracle")
    {
        return "ALTER TABLE " + tableName + " MODIFY (" + columnSql + ")";
    }
    return "ALTER TABLE " + tableName + " MODIFY COLUMN " + columnSql;
}

function _sqlRenameTable(pStep, pDbType)
{
    var sourceTable = _qualifiedTable(pStep.target.schema, pStep.target.table);
    var targetTableName = _normalizeIdentifier(pStep.options.newTableName);
    if (pDbType === "oracle")
    {
        return "ALTER TABLE " + sourceTable + " RENAME TO " + targetTableName;
    }
    return "RENAME TABLE " + sourceTable + " TO " + _qualifiedTable(pStep.target.schema, targetTableName);
}

function _sqlRenameColumn(pStep)
{
    var tableName = _qualifiedTable(pStep.target.schema, pStep.target.table);
    var sourceColumn = _normalizeIdentifier(pStep.column.name);
    var targetColumn = _normalizeIdentifier(pStep.options.newColumnName);
    return "ALTER TABLE " + tableName + " RENAME COLUMN " + sourceColumn + " TO " + targetColumn;
}

function _sqlCreateIndex(pStep, pDbType)
{
    var schema = _normalizeIdentifier(pStep.target.schema);
    var tableName = _qualifiedTable(pStep.target.schema, pStep.target.table);
    var indexName = _normalizeIdentifier(pStep.index.name);
    var uniqueKeyword = pStep.index.unique ? "UNIQUE " : "";
    var indexNameSql = pDbType === "oracle" ? _qualifiedTable(schema, indexName) : indexName;
    var columnSql = [];

    for (var i = 0; i < pStep.index.columns.length; i++)
    {
        var col = pStep.index.columns[i];
        var exprOrName = _isNonEmptyString(col.expression) ? col.expression : _normalizeIdentifier(col.name);
        var direction = _isNonEmptyString(col.direction) ? " " + col.direction.toUpperCase() : "";
        columnSql.push(exprOrName + direction);
    }

    return "CREATE " + uniqueKeyword + "INDEX " + indexNameSql + " ON " + tableName + " (" + columnSql.join(", ") + ")";
}

function _sqlDropIndex(pStep, pDbType)
{
    var schema = _normalizeIdentifier(pStep.target.schema);
    var tableName = _qualifiedTable(pStep.target.schema, pStep.target.table);
    var indexName = _normalizeIdentifier(pStep.index.name);
    if (pDbType === "oracle")
    {
        return "DROP INDEX " + _qualifiedTable(schema, indexName);
    }
    return "DROP INDEX " + indexName + " ON " + tableName;
}

function _columnDefinition(pColumn, pDbType)
{
    var columnName = _normalizeIdentifier(pColumn.name);
    var nativeType = _isNonEmptyString(pColumn.nativeType) ? pColumn.nativeType : _nativeTypeFromCanonical(pColumn, pDbType);
    var sql = columnName + " " + nativeType;

    if (_hasValue(pColumn.defaultRaw))
    {
        sql += " DEFAULT " + pColumn.defaultRaw;
    }
    if (pColumn.nullable === false)
    {
        sql += " NOT NULL";
    }

    return sql;
}

function _nativeTypeFromCanonical(pColumn, pDbType)
{
    var canonicalType = _toUpper(_readString(pColumn.canonicalType, "STRING"));
    var length = _toPositiveInt(pColumn.length, 255);
    var precision = _toPositiveInt(pColumn.precision, 18);
    var scale = _toNonNegativeInt(pColumn.scale, 2);

    if (pDbType === "oracle")
    {
        switch (canonicalType)
        {
            case "STRING":
                return "VARCHAR2(" + length + " CHAR)";
            case "INT":
                return "NUMBER(10)";
            case "BIGINT":
                return "NUMBER(19)";
            case "DECIMAL":
                return "NUMBER(" + precision + "," + scale + ")";
            case "FLOAT":
                return "FLOAT";
            case "BOOLEAN":
                return "NUMBER(1)";
            case "DATE":
                return "DATE";
            case "DATETIME":
                return "TIMESTAMP";
            case "TIME":
                return "VARCHAR2(8 CHAR)";
            case "BINARY":
                return "RAW(" + Math.min(length, 2000) + ")";
            case "BLOB":
                return "BLOB";
            case "CLOB":
                return "CLOB";
            case "JSON":
                return "CLOB";
            case "UUID":
                return "VARCHAR2(36 CHAR)";
            default:
                return "CLOB";
        }
    }

    switch (canonicalType)
    {
        case "STRING":
            return "VARCHAR(" + length + ")";
        case "INT":
            return "INT";
        case "BIGINT":
            return "BIGINT";
        case "DECIMAL":
            return "DECIMAL(" + precision + "," + scale + ")";
        case "FLOAT":
            return "FLOAT";
        case "BOOLEAN":
            return "BOOLEAN";
        case "DATE":
            return "DATE";
        case "DATETIME":
            return "DATETIME";
        case "TIME":
            return "TIME";
        case "BINARY":
            return "VARBINARY(" + length + ")";
        case "BLOB":
            return "BLOB";
        case "CLOB":
            return "LONGTEXT";
        case "JSON":
            return "JSON";
        case "UUID":
            return "CHAR(36)";
        default:
            return "TEXT";
    }
}

function _filterTableNames(pTables, pFilters)
{
    var result = [];
    for (var i = 0; i < pTables.length; i++)
    {
        var table = pTables[i];
        if (!_tableMatchesFilters(table, pFilters))
        {
            continue;
        }
        result.push(_normalizeIdentifier(table.name));
    }
    return result;
}

function _tableMatchesFilters(pTable, pFilters)
{
    if (!_isObject(pFilters))
    {
        return true;
    }

    if (pFilters.includeViews === false && pTable.isView === true)
    {
        return false;
    }

    if (_isNonEmptyString(pFilters.tableNameLike))
    {
        var regex = _sqlLikeToRegex(_toUpper(pFilters.tableNameLike));
        if (!regex.test(_toUpper(pTable.name)))
        {
            return false;
        }
    }

    if (Array.isArray(pFilters.tableNames) && pFilters.tableNames.length > 0)
    {
        var expectedSet = _toLookupSet(pFilters.tableNames);
        if (!expectedSet[_normalizeIdentifier(pTable.name)])
        {
            return false;
        }
    }

    return true;
}

function _filterTables(pTables, pNameLookup)
{
    var result = [];
    for (var i = 0; i < pTables.length; i++)
    {
        var tableName = _normalizeIdentifier(pTables[i].name);
        if (!pNameLookup[tableName])
        {
            continue;
        }
        result.push(pTables[i]);
    }
    return result;
}

function _sqlLikeToRegex(pLikePattern)
{
    var escaped = pLikePattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    var regexBody = escaped.replace(/%/g, ".*")
        .replace(/_/g, ".");
    return new RegExp("^" + regexBody + "$");
}

function _estimateLocking(pAction)
{
    if (_hasValue(LOCKING_BY_ACTION[pAction]))
    {
        return LOCKING_BY_ACTION[pAction];
    }
    return "MEDIUM";
}

function _expectedMethodForAction(pAction)
{
    if (_contains(GET_ACTIONS, pAction))
    {
        return "GET";
    }
    if (_contains(POST_ACTIONS, pAction))
    {
        return "POST";
    }
    return null;
}

function _resolveDbType(pRequest)
{
    var dbTypeCandidates = [
        _toLower(_getQueryValue(pRequest, "dbType")),
        _toLower(_getHeaderValue(pRequest, "X-Db-Type")),
        _toLower(_getHeaderValue(pRequest, "dbType"))
    ];

    for (var i = 0; i < dbTypeCandidates.length; i++)
    {
        if (dbTypeCandidates[i] === "oracle" || dbTypeCandidates[i] === "mariadb")
        {
            return dbTypeCandidates[i];
        }
    }

    return "oracle";
}

function _resolveDbVersion(pDbType)
{
    return pDbType === "oracle" ? "19c" : "10.11";
}

function _parseRequestBody(pRequest)
{
    if (!_hasValue(pRequest.body) || pRequest.body === "")
    {
        return { ok: true, value: {} };
    }

    if (_isObject(pRequest.body))
    {
        return { ok: true, value: pRequest.body };
    }

    if (typeof pRequest.body !== "string")
    {
        return {
            ok: false,
            error: "Body must be a JSON object or a JSON/base64 encoded string."
        };
    }

    var candidates = [];
    try
    {
        var decoded = util.decodeBase64String(pRequest.body, "UTF-8");
        if (_isNonEmptyString(decoded))
        {
            candidates.push(decoded);
        }
    }
    catch (ex)
    {
        // Ignore decode error and try plain JSON body.
    }
    candidates.push(pRequest.body);

    for (var i = 0; i < candidates.length; i++)
    {
        try
        {
            return { ok: true, value: JSON.parse(candidates[i]) };
        }
        catch (parseErr)
        {
            // Try next candidate.
        }
    }

    return {
        ok: false,
        error: "Body is not valid JSON (expected JSON text or base64-encoded JSON)."
    };
}

function _parseRequest(pRawRequest)
{
    if (_isObject(pRawRequest))
    {
        return { ok: true, value: pRawRequest };
    }

    try
    {
        return { ok: true, value: JSON.parse(pRawRequest) };
    }
    catch (ex)
    {
        return {
            ok: false,
            error: (ex && ex.message) ? ex.message : String(ex)
        };
    }
}

function _ensureRequestShape(pRequest)
{
    if (!_isObject(pRequest.query))
    {
        pRequest.query = {};
    }
    if (!_isObject(pRequest.header))
    {
        pRequest.header = {};
    }
    if (!_isObject(pRequest.response))
    {
        pRequest.response = {};
    }
    if (!_isObject(pRequest.response.header))
    {
        pRequest.response.header = {};
    }
}

function _setCommonResponseHeaders(pRequest, pCorrelationId)
{
    pRequest.response.header["Content-Type"] = "application/json; charset=utf-8";
    pRequest.response.header["X-Correlation-Id"] = pCorrelationId;
}

function _writeJsonResponse(pRequest, pStatusCode, pCorrelationId, pBody)
{
    var responseBody = _isObject(pBody) ? pBody : { data: pBody };
    if (!_isNonEmptyString(responseBody.correlationId))
    {
        responseBody.correlationId = pCorrelationId;
    }

    pRequest.response.httpStatusCode = pStatusCode;
    pRequest.response.body = JSON.stringify(responseBody);
    _setCommonResponseHeaders(pRequest, pCorrelationId);
    return JSON.stringify(pRequest);
}

function _writeErrorResponse(pRequest, pStatusCode, pCorrelationId, pCode, pMessage, pDetails)
{
    return _writeJsonResponse(pRequest, pStatusCode, pCorrelationId, {
        correlationId: pCorrelationId,
        error: {
            code: pCode,
            message: pMessage,
            details: _isObject(pDetails) ? pDetails : {}
        }
    });
}

function _ensureCorrelationId(pRequest)
{
    var correlationId = _getHeaderValue(pRequest, "X-Correlation-Id");
    if (!_isUuidV4(correlationId))
    {
        correlationId = _generateUuidV4();
    }
    pRequest.header["X-Correlation-Id"] = correlationId;
    return correlationId;
}

function _getQueryValue(pRequest, pName)
{
    return _getMapValueIgnoreCase(pRequest.query, pName);
}

function _getHeaderValue(pRequest, pName)
{
    return _getMapValueIgnoreCase(pRequest.header, pName);
}

function _getMapValueIgnoreCase(pMap, pName)
{
    if (!_isObject(pMap))
    {
        return null;
    }

    var target = _toLower(pName);
    for (var key in pMap)
    {
        if (Object.prototype.hasOwnProperty.call(pMap, key) && _toLower(key) === target)
        {
            return pMap[key];
        }
    }
    return null;
}

function _qualifiedTable(pSchema, pTable)
{
    return _normalizeIdentifier(pSchema) + "." + _normalizeIdentifier(pTable);
}

function _normalizeIdentifier(pValue)
{
    return _toUpper(_readString(pValue, ""));
}

function _readString(pValue, pDefaultValue)
{
    if (typeof pValue === "string")
    {
        return pValue.trim();
    }
    if (_hasValue(pValue))
    {
        return String(pValue)
            .trim();
    }
    return pDefaultValue;
}

function _readBoolean(pValue, pDefaultValue)
{
    if (typeof pValue === "boolean")
    {
        return pValue;
    }
    if (!_hasValue(pValue))
    {
        return pDefaultValue;
    }
    var value = _toLower(String(pValue)
        .trim());
    if (value === "true")
    {
        return true;
    }
    if (value === "false")
    {
        return false;
    }
    return pDefaultValue;
}

function _containsTrue(pObject, pProperty)
{
    if (!_isObject(pObject))
    {
        return false;
    }
    return pObject[pProperty] === true;
}

function _toLookupSet(pValues)
{
    var set = {};
    if (!Array.isArray(pValues))
    {
        return set;
    }
    for (var i = 0; i < pValues.length; i++)
    {
        if (_isNonEmptyString(pValues[i]))
        {
            set[_normalizeIdentifier(pValues[i])] = true;
        }
    }
    return set;
}

function _toPositiveInt(pValue, pDefaultValue)
{
    var parsed = parseInt(pValue, 10);
    if (isNaN(parsed) || parsed <= 0)
    {
        return pDefaultValue;
    }
    return parsed;
}

function _toNonNegativeInt(pValue, pDefaultValue)
{
    var parsed = parseInt(pValue, 10);
    if (isNaN(parsed) || parsed < 0)
    {
        return pDefaultValue;
    }
    return parsed;
}

function _contains(pArray, pValue)
{
    return Array.isArray(pArray) && pArray.indexOf(pValue) !== -1;
}

function _isObject(pValue)
{
    return pValue != null && typeof pValue === "object" && !Array.isArray(pValue);
}

function _isNonEmptyString(pValue)
{
    return typeof pValue === "string" && pValue.trim().length > 0;
}

function _hasValue(pValue)
{
    return pValue !== undefined && pValue !== null;
}

function _toLower(pValue)
{
    return _readString(pValue, "")
        .toLowerCase();
}

function _toUpper(pValue)
{
    return _readString(pValue, "")
        .toUpperCase();
}

function _isUuidV4(pValue)
{
    return _isNonEmptyString(pValue) && UUID_V4_REGEX.test(pValue);
}

function _generateUuidV4()
{
    try
    {
        var generated = util.getNewUUID();
        if (_isUuidV4(generated))
        {
            return generated;
        }
    }
    catch (ex)
    {
        // Fall through to pseudo-random UUID generation.
    }

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c)
    {
        var r = Math.random() * 16 | 0;
        var v = c === "x" ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function _nowIso()
{
    return new Date()
        .toISOString();
}

function _getDbContext(pRequest)
{
    var alias = _resolveDbAlias(pRequest);
    var dbType = _resolveDbTypeFromAlias(alias, pRequest);
    var dbVersion = _resolveDbVersionFromDatabase(dbType, alias);
    var defaultSchema = _resolveDefaultSchemaFromDatabase(dbType, alias, pRequest);

    return {
        alias: alias,
        dbType: dbType,
        dbVersion: dbVersion,
        defaultSchema: defaultSchema
    };
}

function _resolveDbAlias(pRequest)
{
    var candidates = [
        _getQueryValue(pRequest, "dbAlias"),
        _getQueryValue(pRequest, "alias"),
        _getHeaderValue(pRequest, "X-Db-Alias"),
        _getHeaderValue(pRequest, "dbAlias"),
        _getHeaderValue(pRequest, "alias")
    ];

    for (var i = 0; i < candidates.length; i++)
    {
        if (_isNonEmptyString(candidates[i]))
        {
            return candidates[i];
        }
    }

    try
    {
        var currentAlias = db.getCurrentAlias();
        if (_isNonEmptyString(currentAlias))
        {
            return currentAlias;
        }
    }
    catch (ex)
    {
        // Ignore and use fallback.
    }

    return "Data_alias";
}

function _resolveDbTypeFromAlias(pAlias, pRequest)
{
    try
    {
        var dbType = Number(db.getDatabaseType(pAlias));
        if (dbType === db.DBTYPE_ORACLE10_CLUSTER
            || dbType === db.DBTYPE_ORACLE10_OCI
            || dbType === db.DBTYPE_ORACLE10_THIN)
        {
            return "oracle";
        }
        if (dbType === db.DBTYPE_MARIADB10 || dbType === db.DBTYPE_MYSQL4)
        {
            return "mariadb";
        }
    }
    catch (ex)
    {
        // Fallback to explicit request hints.
    }

    return _resolveDbType(pRequest);
}

function _resolveDbVersionFromDatabase(pDbType, pAlias)
{
    try
    {
        if (pDbType === "oracle")
        {
            var oracleVersion = db.cell(
                "select version from product_component_version where product like 'Oracle Database%' and rownum = 1",
                pAlias
            );
            if (_isNonEmptyString(oracleVersion))
            {
                return _readString(oracleVersion, "19c");
            }

            var instanceVersion = db.cell("select version from v$instance", pAlias);
            if (_isNonEmptyString(instanceVersion))
            {
                return _readString(instanceVersion, "19c");
            }

            return "19c";
        }

        var mariaVersion = db.cell("select version()", pAlias);
        if (_isNonEmptyString(mariaVersion))
        {
            return _readString(mariaVersion, "10.11");
        }
    }
    catch (ex)
    {
        // Ignore and use defaults.
    }

    return pDbType === "oracle" ? "19c" : "10.11";
}

function _resolveDefaultSchemaFromDatabase(pDbType, pAlias, pRequest)
{
    var requestSchema = _readString(_getQueryValue(pRequest, "schema") || _getHeaderValue(pRequest, "X-Schema"), "");
    if (_isNonEmptyString(requestSchema))
    {
        return pDbType === "oracle" ? _normalizeIdentifier(requestSchema) : requestSchema;
    }

    try
    {
        if (pDbType === "oracle")
        {
            var currentSchema = db.cell("select sys_context('USERENV', 'CURRENT_SCHEMA') from dual", pAlias);
            if (_isNonEmptyString(currentSchema))
            {
                return _normalizeIdentifier(currentSchema);
            }
            var currentUser = db.cell("select user from dual", pAlias);
            if (_isNonEmptyString(currentUser))
            {
                return _normalizeIdentifier(currentUser);
            }
            return "CRM";
        }

        var currentDatabase = db.cell("select database()", pAlias);
        if (_isNonEmptyString(currentDatabase))
        {
            return _readString(currentDatabase, "crm");
        }
    }
    catch (ex)
    {
        // Ignore and use defaults.
    }

    return pDbType === "oracle" ? "CRM" : "crm";
}

function _loadMetadataFromDatabase(pDbCtx, pPayload)
{
    try
    {
        var include = _isObject(pPayload.include) ? pPayload.include : {};
        var filters = _isObject(pPayload.filters) ? pPayload.filters : {};
        var page = _isObject(pPayload.page) ? pPayload.page : {};
        var queryOptions = _resolveMetadataQueryOptions(_isObject(pPayload.options) ? pPayload.options : {});

        var includeTables = !_hasValue(include.tables) || include.tables === true;
        var includeColumns = !_hasValue(include.columns) || include.columns === true;
        var includeIndexes = !_hasValue(include.indexes) || include.indexes === true;
        var includeViews = _readBoolean(filters.includeViews, false);
        var includeSystemIndexes = _readBoolean(filters.includeSystemIndexes, false);

        var pageSize = _toPositiveInt(page.pageSize, 200);
        if (pageSize > 1000)
        {
            pageSize = 1000;
        }
        if ((includeColumns || includeIndexes) && pageSize > queryOptions.maxObjectsPerPage)
        {
            pageSize = queryOptions.maxObjectsPerPage;
        }

        var schema = _normalizeIdentifier(pPayload.schema);
        var allTables = _queryMetadataTables(pDbCtx, schema, includeViews);
        var filteredNames = _filterTableNames(allTables, filters);
        filteredNames.sort();

        var paging = _applyNamePaging(filteredNames, pageSize, page.pageToken);
        var pageNameLookup = _toLookupSet(paging.items);
        var pageTables = _filterTables(allTables, pageNameLookup);
        var pageColumns = includeColumns ? _queryMetadataColumns(pDbCtx, schema, paging.items, queryOptions) : [];
        var pageIndexes = includeIndexes ? _queryMetadataIndexes(pDbCtx, schema, paging.items, includeSystemIndexes, queryOptions) : [];

        if (queryOptions.matchByTableNameOnly)
        {
            _rewriteMetadataSchemaForComparison(pageTables, pageColumns, pageIndexes, queryOptions.comparisonSchema);
        }

        return {
            ok: true,
            page: {
                pageSize: pageSize,
                nextPageToken: paging.nextPageToken
            },
            tables: includeTables ? pageTables : [],
            columns: pageColumns,
            indexes: pageIndexes
        };
    }
    catch (ex)
    {
        return {
            ok: false,
            statusCode: 500,
            errorCode: "INTERNAL_ERROR",
            message: "Failed to export metadata.",
            details: {
                reason: (ex && ex.message) ? ex.message : String(ex)
            }
        };
    }
}

function _queryMetadataTables(pDbCtx, pSchema, pIncludeViews)
{
    if (_isOracleDbType(pDbCtx.dbType))
    {
        return _queryOracleMetadataTables(pDbCtx.alias, pSchema, pIncludeViews);
    }
    return _queryMariaMetadataTables(pDbCtx.alias, pSchema, pIncludeViews);
}

function _queryMetadataColumns(pDbCtx, pSchema, pTableNames, pQueryOptions)
{
    if (!Array.isArray(pTableNames) || pTableNames.length === 0)
    {
        return [];
    }

    var options = _isObject(pQueryOptions) ? pQueryOptions : {};
    var includeColumnDefaults = _readBoolean(options.includeColumnDefaults, false);
    var includeColumnComments = _readBoolean(options.includeColumnComments, false);
    var useCache = _readBoolean(options.useCache, true);
    var cacheTtlMs = _toPositiveInt(options.cacheTtlSeconds, Math.floor(METADATA_DEFAULT_CACHE_TTL_MS / 1000)) * 1000;
    var normalizedTables = _normalizeTableNames(pTableNames);
    var missingTables = [];
    var result = [];
    var i;

    for (i = 0; i < normalizedTables.length; i++)
    {
        var tableName = normalizedTables[i];
        var cacheKey = _metadataColumnsCacheKey(pDbCtx.alias, pSchema, tableName, includeColumnDefaults, includeColumnComments);
        var cachedColumns = useCache ? _metadataCacheGet("columns", cacheKey) : null;
        if (cachedColumns != null)
        {
            result = result.concat(cachedColumns);
        }
        else
        {
            missingTables.push(tableName);
        }
    }

    if (missingTables.length > 0)
    {
        var fetched = _isOracleDbType(pDbCtx.dbType)
            ? _queryOracleMetadataColumns(pDbCtx.alias, pSchema, missingTables, includeColumnDefaults, includeColumnComments)
            : _queryMariaMetadataColumns(pDbCtx.alias, pSchema, missingTables);
        var groupedByTable = _groupMetadataRowsByTable(fetched);

        for (i = 0; i < missingTables.length; i++)
        {
            var missingTableName = missingTables[i];
            var items = groupedByTable[missingTableName] || [];
            if (useCache)
            {
                _metadataCachePut(
                    "columns",
                    _metadataColumnsCacheKey(pDbCtx.alias, pSchema, missingTableName, includeColumnDefaults, includeColumnComments),
                    items,
                    cacheTtlMs
                );
            }
            result = result.concat(items);
        }
    }

    result.sort(function(a, b)
    {
        var tableCompare = _compareIdentifier(a.table, b.table);
        if (tableCompare !== 0)
        {
            return tableCompare;
        }
        return _toPositiveInt(a.ordinalPosition, 1) - _toPositiveInt(b.ordinalPosition, 1);
    });

    return result;
}

function _queryMetadataIndexes(pDbCtx, pSchema, pTableNames, pIncludeSystemIndexes, pQueryOptions)
{
    if (!Array.isArray(pTableNames) || pTableNames.length === 0)
    {
        return [];
    }

    var options = _isObject(pQueryOptions) ? pQueryOptions : {};
    var includeIndexExpressions = _readBoolean(options.includeIndexExpressions, false);
    var useCache = _readBoolean(options.useCache, true);
    var cacheTtlMs = _toPositiveInt(options.cacheTtlSeconds, Math.floor(METADATA_DEFAULT_CACHE_TTL_MS / 1000)) * 1000;
    var normalizedTables = _normalizeTableNames(pTableNames);
    var missingTables = [];
    var result = [];
    var i;

    for (i = 0; i < normalizedTables.length; i++)
    {
        var tableName = normalizedTables[i];
        var cacheKey = _metadataIndexesCacheKey(
            pDbCtx.alias,
            pSchema,
            tableName,
            pIncludeSystemIndexes,
            includeIndexExpressions
        );
        var cachedIndexes = useCache ? _metadataCacheGet("indexes", cacheKey) : null;
        if (cachedIndexes != null)
        {
            result = result.concat(cachedIndexes);
        }
        else
        {
            missingTables.push(tableName);
        }
    }

    if (missingTables.length > 0)
    {
        var fetched = _isOracleDbType(pDbCtx.dbType)
            ? _queryOracleMetadataIndexes(pDbCtx.alias, pSchema, missingTables, pIncludeSystemIndexes, includeIndexExpressions)
            : _queryMariaMetadataIndexes(pDbCtx.alias, pSchema, missingTables, pIncludeSystemIndexes);
        var groupedByTable = _groupMetadataRowsByTable(fetched);

        for (i = 0; i < missingTables.length; i++)
        {
            var missingTableName = missingTables[i];
            var items = groupedByTable[missingTableName] || [];
            if (useCache)
            {
                _metadataCachePut(
                    "indexes",
                    _metadataIndexesCacheKey(
                        pDbCtx.alias,
                        pSchema,
                        missingTableName,
                        pIncludeSystemIndexes,
                        includeIndexExpressions
                    ),
                    items,
                    cacheTtlMs
                );
            }
            result = result.concat(items);
        }
    }

    result.sort(function(a, b)
    {
        var tableCompare = _compareIdentifier(a.table, b.table);
        if (tableCompare !== 0)
        {
            return tableCompare;
        }
        return _compareIdentifier(a.name, b.name);
    });

    return result;
}

function _queryOracleMetadataTables(pAlias, pSchema, pIncludeViews)
{
    var schemaLiteral = _sqlLiteral(_normalizeIdentifier(pSchema), pAlias);
    var sql = ""
        + "select owner, table_name, is_view, tablespace_name, comments "
        + "from ("
        + " select t.owner as owner, t.table_name as table_name, 'N' as is_view, t.tablespace_name as tablespace_name, c.comments as comments "
        + " from all_tables t "
        + " left join all_tab_comments c on c.owner = t.owner and c.table_name = t.table_name "
        + " where t.owner = " + schemaLiteral;

    if (pIncludeViews)
    {
        sql += ""
            + " union all "
            + " select v.owner as owner, v.view_name as table_name, 'Y' as is_view, null as tablespace_name, c.comments as comments "
            + " from all_views v "
            + " left join all_tab_comments c on c.owner = v.owner and c.table_name = v.view_name "
            + " where v.owner = " + schemaLiteral;
    }

    sql += ") order by table_name";

    var rows = db.table(sql, pAlias);
    var result = [];
    for (var i = 0; i < rows.length; i++)
    {
        var isView = _toUpper(rows[i][2]) === "Y";
        result.push({
            schema: _normalizeIdentifier(rows[i][0]),
            name: _normalizeIdentifier(rows[i][1]),
            isView: isView,
            comment: _toNullableString(rows[i][4]),
            storage: {
                engine: null,
                tablespace: isView ? null : _toNullableString(rows[i][3])
            }
        });
    }

    return result;
}

function _queryMariaMetadataTables(pAlias, pSchema, pIncludeViews)
{
    var schemaLiteral = _sqlLiteral(_normalizeIdentifier(pSchema), pAlias);
    var sql = ""
        + "select table_schema, table_name, table_type, engine, table_comment "
        + "from information_schema.tables "
        + "where upper(table_schema) = " + schemaLiteral + " "
        + "order by table_name";

    var rows = db.table(sql, pAlias);
    var result = [];
    for (var i = 0; i < rows.length; i++)
    {
        var isView = _toUpper(rows[i][2]) === "VIEW";
        if (!pIncludeViews && isView)
        {
            continue;
        }
        result.push({
            schema: _normalizeIdentifier(rows[i][0]),
            name: _normalizeIdentifier(rows[i][1]),
            isView: isView,
            comment: _toNullableString(rows[i][4]),
            storage: {
                engine: isView ? null : _toNullableString(rows[i][3]),
                tablespace: null
            }
        });
    }
    return result;
}

function _queryOracleMetadataColumns(pAlias, pSchema, pTableNames, pIncludeDefaults, pIncludeComments)
{
    var schemaLiteral = _sqlLiteral(_normalizeIdentifier(pSchema), pAlias);
    var chunks = _chunkArray(pTableNames, 40);
    var rows = [];

    for (var chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++)
    {
        var sql = ""
            + "select c.owner, c.table_name, c.column_name, c.column_id, c.data_type, c.data_length, "
            + " c.data_precision, c.data_scale, c.nullable, "
            + (pIncludeDefaults ? "c.data_default" : "cast(null as varchar2(1)) as data_default") + ", "
            + (pIncludeComments ? "cc.comments" : "cast(null as varchar2(1)) as comments") + ", "
            + " c.char_col_decl_length, c.char_used "
            + "from all_tab_columns c ";

        if (pIncludeComments)
        {
            sql += "left join all_col_comments cc "
                + " on cc.owner = c.owner and cc.table_name = c.table_name and cc.column_name = c.column_name ";
        }

        sql += "where c.owner = " + schemaLiteral + " "
            + " and c.table_name in " + _sqlStringInList(chunks[chunkIndex], pAlias) + " "
            + "order by c.table_name, c.column_id";

        rows = rows.concat(db.table(sql, pAlias));
    }

    var result = [];

    for (var i = 0; i < rows.length; i++)
    {
        var dataType = _toUpper(rows[i][4]);
        var length = _toIntOrNull(rows[i][11]);
        if (length == null)
        {
            length = _toIntOrNull(rows[i][5]);
        }
        var dataLength = _toIntOrNull(rows[i][5]);
        var precision = _toIntOrNull(rows[i][6]);
        var scale = _toIntOrNull(rows[i][7]);
        var nativeType = _oracleNativeType(dataType, length, dataLength, precision, scale, _toUpper(rows[i][12]));

        result.push({
            schema: _normalizeIdentifier(rows[i][0]),
            table: _normalizeIdentifier(rows[i][1]),
            name: _normalizeIdentifier(rows[i][2]),
            ordinalPosition: _toPositiveInt(rows[i][3], 1),
            nativeType: nativeType,
            canonicalType: _canonicalTypeFromOracle(dataType, nativeType, precision, scale),
            length: length,
            precision: precision,
            scale: scale,
            nullable: _toUpper(rows[i][8]) === "Y",
            defaultRaw: _toNullableString(rows[i][9]),
            comment: _toNullableString(rows[i][10]),
            charset: null,
            collation: null
        });
    }

    return result;
}

function _queryMariaMetadataColumns(pAlias, pSchema, pTableNames)
{
    var schemaLiteral = _sqlLiteral(_normalizeIdentifier(pSchema), pAlias);
    var sql = ""
        + "select c.table_schema, c.table_name, c.column_name, c.ordinal_position, c.column_type, c.data_type, "
        + " c.character_maximum_length, c.numeric_precision, c.numeric_scale, c.is_nullable, c.column_default, "
        + " c.column_comment, c.character_set_name, c.collation_name "
        + "from information_schema.columns c "
        + "where upper(c.table_schema) = " + schemaLiteral + " "
        + " and upper(c.table_name) in " + _sqlStringInList(pTableNames, pAlias) + " "
        + "order by c.table_name, c.ordinal_position";

    var rows = db.table(sql, pAlias);
    var result = [];

    for (var i = 0; i < rows.length; i++)
    {
        var nativeType = _readString(rows[i][4], "TEXT");
        var dataType = _toLower(rows[i][5]);
        var length = _toIntOrNull(rows[i][6]);
        var precision = _toIntOrNull(rows[i][7]);
        var scale = _toIntOrNull(rows[i][8]);

        result.push({
            schema: _normalizeIdentifier(rows[i][0]),
            table: _normalizeIdentifier(rows[i][1]),
            name: _normalizeIdentifier(rows[i][2]),
            ordinalPosition: _toPositiveInt(rows[i][3], 1),
            nativeType: nativeType,
            canonicalType: _canonicalTypeFromMaria(dataType, nativeType),
            length: length,
            precision: precision,
            scale: scale,
            nullable: _toUpper(rows[i][9]) === "YES",
            defaultRaw: _toNullableString(rows[i][10]),
            comment: _toNullableString(rows[i][11]),
            charset: _toNullableString(rows[i][12]),
            collation: _toNullableString(rows[i][13])
        });
    }

    return result;
}

function _queryOracleMetadataIndexes(pAlias, pSchema, pTableNames, pIncludeSystemIndexes, pIncludeExpressions)
{
    var schemaLiteral = _sqlLiteral(_normalizeIdentifier(pSchema), pAlias);
    var chunks = _chunkArray(pTableNames, 40);
    var rows = [];

    for (var chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++)
    {
        var sql = ""
            + "select i.table_owner, i.table_name, i.index_name, i.uniqueness, i.index_type, i.tablespace_name, i.generated, "
            + " c.column_position, c.column_name, c.descend, "
            + (pIncludeExpressions ? "e.column_expression" : "cast(null as varchar2(1)) as column_expression") + " "
            + "from all_indexes i "
            + "join all_ind_columns c "
            + " on c.index_owner = i.owner and c.index_name = i.index_name and c.table_owner = i.table_owner and c.table_name = i.table_name ";

        if (pIncludeExpressions)
        {
            sql += "left join all_ind_expressions e "
                + " on e.index_owner = c.index_owner and e.index_name = c.index_name and e.table_owner = c.table_owner and e.table_name = c.table_name and e.column_position = c.column_position ";
        }

        sql += "where i.table_owner = " + schemaLiteral + " "
            + " and i.table_name in " + _sqlStringInList(chunks[chunkIndex], pAlias) + " "
            + "order by i.table_name, i.index_name, c.column_position";

        rows = rows.concat(db.table(sql, pAlias));
    }

    return _buildIndexListFromRows(rows, "oracle", pIncludeSystemIndexes);
}

function _queryMariaMetadataIndexes(pAlias, pSchema, pTableNames, pIncludeSystemIndexes)
{
    var schemaLiteral = _sqlLiteral(_normalizeIdentifier(pSchema), pAlias);
    var sql = ""
        + "select s.table_schema, s.table_name, s.index_name, s.non_unique, s.index_type, s.seq_in_index, s.column_name, s.collation "
        + "from information_schema.statistics s "
        + "where upper(s.table_schema) = " + schemaLiteral + " "
        + " and upper(s.table_name) in " + _sqlStringInList(pTableNames, pAlias) + " "
        + "order by s.table_name, s.index_name, s.seq_in_index";

    var rows = db.table(sql, pAlias);
    return _buildIndexListFromRows(rows, "mariadb", pIncludeSystemIndexes);
}

function _buildIndexListFromRows(pRows, pDbType, pIncludeSystemIndexes)
{
    var indexesByKey = {};
    var orderedKeys = [];

    for (var i = 0; i < pRows.length; i++)
    {
        var row = pRows[i];
        var schema;
        var table;
        var indexName;
        var unique;
        var indexType;
        var tablespace = null;
        var generated = null;
        var colPosition;
        var colName;
        var colDirection;
        var colExpression = null;

        if (pDbType === "oracle")
        {
            schema = _normalizeIdentifier(row[0]);
            table = _normalizeIdentifier(row[1]);
            indexName = _normalizeIdentifier(row[2]);
            unique = _toUpper(row[3]) === "UNIQUE";
            indexType = _normalizeIndexType(row[4]);
            tablespace = _toNullableString(row[5]);
            generated = _toUpper(row[6]);
            colPosition = _toPositiveInt(row[7], 1);
            colName = _isNonEmptyString(row[8]) ? _normalizeIdentifier(row[8]) : "";
            colDirection = _toUpper(row[9]) === "DESC" ? "DESC" : "ASC";
            colExpression = _toNullableString(row[10]);
        }
        else
        {
            schema = _normalizeIdentifier(row[0]);
            table = _normalizeIdentifier(row[1]);
            indexName = _normalizeIdentifier(row[2]);
            unique = _toIntOrNull(row[3]) === 0;
            indexType = _normalizeIndexType(row[4]);
            colPosition = _toPositiveInt(row[5], 1);
            colName = _normalizeIdentifier(row[6]);
            colDirection = _toUpper(row[7]) === "D" ? "DESC" : "ASC";
        }

        var isSystemIndex = indexName === "PRIMARY" || indexName.indexOf("SYS_") === 0 || generated === "Y";
        if (!pIncludeSystemIndexes && isSystemIndex)
        {
            continue;
        }

        var key = schema + "." + table + "." + indexName;
        if (!indexesByKey[key])
        {
            indexesByKey[key] = {
                schema: schema,
                table: table,
                name: indexName,
                unique: unique,
                indexType: indexType,
                tablespace: tablespace,
                whereClause: null,
                columns: []
            };
            orderedKeys.push(key);
        }

        indexesByKey[key].columns.push({
            name: colName,
            position: colPosition,
            direction: colDirection,
            expression: colExpression
        });
    }

    var result = [];
    for (var j = 0; j < orderedKeys.length; j++)
    {
        result.push(indexesByKey[orderedKeys[j]]);
    }
    return result;
}

function _oracleNativeType(pDataType, pCharLength, pDataLength, pPrecision, pScale, pCharUsed)
{
    var dataType = _toUpper(pDataType);
    if (dataType === "VARCHAR2" || dataType === "NVARCHAR2" || dataType === "CHAR" || dataType === "NCHAR")
    {
        var len = pCharLength != null ? pCharLength : pDataLength;
        var charUnit = pCharUsed === "C" ? " CHAR" : " BYTE";
        if (len == null)
        {
            return dataType;
        }
        return dataType + "(" + len + charUnit + ")";
    }
    if (dataType === "NUMBER")
    {
        if (pPrecision == null)
        {
            return "NUMBER";
        }
        if (pScale == null)
        {
            return "NUMBER(" + pPrecision + ")";
        }
        return "NUMBER(" + pPrecision + "," + pScale + ")";
    }
    if (dataType === "RAW")
    {
        if (pDataLength == null)
        {
            return "RAW";
        }
        return "RAW(" + pDataLength + ")";
    }
    return dataType;
}

function _canonicalTypeFromOracle(pDataType, pNativeType, pPrecision, pScale)
{
    var dataType = _toUpper(pDataType);
    var nativeType = _toUpper(pNativeType);

    if (dataType === "VARCHAR2" || dataType === "NVARCHAR2" || dataType === "CHAR" || dataType === "NCHAR")
    {
        return "STRING";
    }
    if (dataType === "NUMBER")
    {
        if (pScale != null && Number(pScale) > 0)
        {
            return "DECIMAL";
        }
        if (pPrecision != null)
        {
            if (Number(pPrecision) <= 10)
            {
                return "INT";
            }
            if (Number(pPrecision) <= 19)
            {
                return "BIGINT";
            }
        }
        return "DECIMAL";
    }
    if (dataType === "FLOAT" || dataType === "BINARY_FLOAT" || dataType === "BINARY_DOUBLE")
    {
        return "FLOAT";
    }
    if (dataType === "DATE")
    {
        return "DATE";
    }
    if (dataType.indexOf("TIMESTAMP") === 0)
    {
        return "DATETIME";
    }
    if (dataType === "RAW")
    {
        return "BINARY";
    }
    if (dataType === "BLOB" || dataType === "LONG RAW")
    {
        return "BLOB";
    }
    if (dataType === "CLOB" || dataType === "NCLOB" || dataType === "LONG")
    {
        return "CLOB";
    }
    if (dataType === "JSON" || nativeType.indexOf(" JSON") !== -1)
    {
        return "JSON";
    }
    return "OTHER";
}

function _canonicalTypeFromMaria(pDataType, pNativeType)
{
    var dataType = _toLower(pDataType);
    var nativeType = _toLower(pNativeType);

    if (dataType === "varchar" || dataType === "char" || dataType === "enum" || dataType === "set")
    {
        return "STRING";
    }
    if (dataType === "text" || dataType === "tinytext" || dataType === "mediumtext" || dataType === "longtext")
    {
        return "CLOB";
    }
    if (dataType === "tinyint")
    {
        if (nativeType.indexOf("tinyint(1)") === 0)
        {
            return "BOOLEAN";
        }
        return "INT";
    }
    if (dataType === "smallint" || dataType === "mediumint" || dataType === "int" || dataType === "integer")
    {
        return "INT";
    }
    if (dataType === "bigint")
    {
        return "BIGINT";
    }
    if (dataType === "decimal" || dataType === "numeric")
    {
        return "DECIMAL";
    }
    if (dataType === "float" || dataType === "double" || dataType === "real")
    {
        return "FLOAT";
    }
    if (dataType === "bit" || dataType === "boolean" || dataType === "bool")
    {
        return "BOOLEAN";
    }
    if (dataType === "date")
    {
        return "DATE";
    }
    if (dataType === "datetime" || dataType === "timestamp")
    {
        return "DATETIME";
    }
    if (dataType === "time")
    {
        return "TIME";
    }
    if (dataType === "binary" || dataType === "varbinary")
    {
        return "BINARY";
    }
    if (dataType === "blob" || dataType === "tinyblob" || dataType === "mediumblob" || dataType === "longblob")
    {
        return "BLOB";
    }
    if (dataType === "json")
    {
        return "JSON";
    }
    return "OTHER";
}

function _normalizeIndexType(pValue)
{
    var indexType = _toUpper(pValue);
    if (!indexType || indexType === "NORMAL")
    {
        return "BTREE";
    }
    return indexType;
}

function _applyNamePaging(pNames, pPageSize, pPageToken)
{
    var token = _normalizePageToken(pPageToken);
    var startIndex = 0;
    if (_isNonEmptyString(token))
    {
        while (startIndex < pNames.length && pNames[startIndex] <= token)
        {
            startIndex++;
        }
    }

    var endIndex = Math.min(startIndex + pPageSize, pNames.length);
    var items = pNames.slice(startIndex, endIndex);
    var nextPageToken = null;
    if (endIndex < pNames.length && items.length > 0)
    {
        nextPageToken = items[items.length - 1];
    }

    return {
        items: items,
        nextPageToken: nextPageToken
    };
}

function _normalizePageToken(pToken)
{
    if (!_isNonEmptyString(pToken))
    {
        return null;
    }
    return _normalizeIdentifier(pToken);
}

function _sqlLiteral(pValue, pAlias)
{
    var rawValue = _readString(pValue, "");
    try
    {
        return "'" + db.quote(rawValue, pAlias) + "'";
    }
    catch (ex)
    {
        return "'" + rawValue.replace(/'/g, "''") + "'";
    }
}

function _sqlStringInList(pValues, pAlias)
{
    var safeValues = [];
    for (var i = 0; i < pValues.length; i++)
    {
        safeValues.push(_sqlLiteral(_normalizeIdentifier(pValues[i]), pAlias));
    }
    if (safeValues.length === 0)
    {
        return "('')";
    }
    return "(" + safeValues.join(", ") + ")";
}

function _toNullableString(pValue)
{
    if (!_hasValue(pValue))
    {
        return null;
    }
    var value = _readString(pValue, "");
    return value === "" ? null : value;
}

function _toIntOrNull(pValue)
{
    if (!_hasValue(pValue))
    {
        return null;
    }
    var parsed = parseInt(pValue, 10);
    return isNaN(parsed) ? null : parsed;
}

function _validateStepAgainstDatabase(pStep, pDbCtx, pStrict)
{
    var blockingIssues = [];
    var warnings = [];

    function _report(pMessage)
    {
        warnings.push(pMessage);
    }

    try
    {
        if (!_isObject(pStep) || !_isObject(pStep.target))
        {
            return { blockingIssues: blockingIssues, warnings: warnings };
        }

        var schema = _normalizeIdentifier(pStep.target.schema);
        var table = _normalizeIdentifier(pStep.target.table);
        var action = pStep.action;
        var options = _isObject(pStep.options) ? pStep.options : {};
        var columnName = _isObject(pStep.column) ? _normalizeIdentifier(pStep.column.name) : null;
        var indexName = _isObject(pStep.index) ? _normalizeIdentifier(pStep.index.name) : null;
        var newTableName = _isObject(options) ? _normalizeIdentifier(options.newTableName) : null;
        var newColumnName = _isObject(options) ? _normalizeIdentifier(options.newColumnName) : null;

        if (action === "CREATE_TABLE")
        {
            if (_tableOrViewExists(schema, table, pDbCtx))
            {
                if (_readBoolean(options.ifNotExists, false))
                {
                    if (_isMariaDbType(pDbCtx.dbType))
                    {
                        _report("Table " + schema + "." + table + " already exists and would be skipped.");
                    }
                    else
                    {
                        blockingIssues.push("options.ifNotExists is not supported for CREATE_TABLE on oracle.");
                    }
                }
                else
                {
                    blockingIssues.push("Table " + schema + "." + table + " already exists.");
                }
            }
        }
        else if (action === "DROP_TABLE")
        {
            if (!_tableOrViewExists(schema, table, pDbCtx))
            {
                if (_readBoolean(options.ifExists, false))
                {
                    if (_isMariaDbType(pDbCtx.dbType))
                    {
                        _report("Table " + schema + "." + table + " does not exist and would be skipped.");
                    }
                    else
                    {
                        blockingIssues.push("options.ifExists is not supported for DROP_TABLE on oracle.");
                    }
                }
                else
                {
                    blockingIssues.push("Table " + schema + "." + table + " does not exist.");
                }
            }
        }
        else if (action === "ADD_COLUMN")
        {
            if (!_tableExists(schema, table, pDbCtx))
            {
                blockingIssues.push("Target table " + schema + "." + table + " does not exist.");
            }
            else if (_columnExists(schema, table, columnName, pDbCtx))
            {
                if (_readBoolean(options.ifNotExists, false))
                {
                    if (_isMariaDbType(pDbCtx.dbType))
                    {
                        _report("Column " + columnName + " already exists and would be skipped.");
                    }
                    else
                    {
                        blockingIssues.push("options.ifNotExists is not supported for ADD_COLUMN on oracle.");
                    }
                }
                else
                {
                    blockingIssues.push("Column " + columnName + " already exists in " + schema + "." + table + ".");
                }
            }
        }
        else if (action === "DROP_COLUMN")
        {
            if (!_tableExists(schema, table, pDbCtx))
            {
                blockingIssues.push("Target table " + schema + "." + table + " does not exist.");
            }
            else if (!_columnExists(schema, table, columnName, pDbCtx))
            {
                if (_readBoolean(options.ifExists, false))
                {
                    if (_isMariaDbType(pDbCtx.dbType))
                    {
                        _report("Column " + columnName + " does not exist and would be skipped.");
                    }
                    else
                    {
                        blockingIssues.push("options.ifExists is not supported for DROP_COLUMN on oracle.");
                    }
                }
                else
                {
                    blockingIssues.push("Column " + columnName + " does not exist in " + schema + "." + table + ".");
                }
            }
        }
        else if (action === "ALTER_COLUMN")
        {
            if (!_tableExists(schema, table, pDbCtx))
            {
                blockingIssues.push("Target table " + schema + "." + table + " does not exist.");
            }
            else if (!_columnExists(schema, table, columnName, pDbCtx))
            {
                blockingIssues.push("Column " + columnName + " does not exist in " + schema + "." + table + ".");
            }
        }
        else if (action === "RENAME_TABLE")
        {
            if (!_tableExists(schema, table, pDbCtx))
            {
                blockingIssues.push("Target table " + schema + "." + table + " does not exist.");
            }
            if (_isNonEmptyString(newTableName) && _tableOrViewExists(schema, newTableName, pDbCtx))
            {
                blockingIssues.push("New table name " + schema + "." + newTableName + " already exists.");
            }
        }
        else if (action === "RENAME_COLUMN")
        {
            if (!_tableExists(schema, table, pDbCtx))
            {
                blockingIssues.push("Target table " + schema + "." + table + " does not exist.");
            }
            else
            {
                if (!_columnExists(schema, table, columnName, pDbCtx))
                {
                    blockingIssues.push("Column " + columnName + " does not exist in " + schema + "." + table + ".");
                }
                if (_isNonEmptyString(newColumnName) && _columnExists(schema, table, newColumnName, pDbCtx))
                {
                    blockingIssues.push("Column " + newColumnName + " already exists in " + schema + "." + table + ".");
                }
            }
        }
        else if (action === "CREATE_INDEX")
        {
            if (!_tableExists(schema, table, pDbCtx))
            {
                blockingIssues.push("Target table " + schema + "." + table + " does not exist.");
            }
            else if (_indexExists(schema, table, indexName, pDbCtx))
            {
                blockingIssues.push("Index " + indexName + " already exists on " + schema + "." + table + ".");
            }
        }
        else if (action === "DROP_INDEX")
        {
            if (!_tableExists(schema, table, pDbCtx))
            {
                blockingIssues.push("Target table " + schema + "." + table + " does not exist.");
            }
            else if (!_indexExists(schema, table, indexName, pDbCtx))
            {
                blockingIssues.push("Index " + indexName + " does not exist on " + schema + "." + table + ".");
            }
        }
    }
    catch (ex)
    {
        blockingIssues.push("Database validation failed: " + ((ex && ex.message) ? ex.message : String(ex)));
    }

    return {
        blockingIssues: blockingIssues,
        warnings: warnings
    };
}

function _tableOrViewExists(pSchema, pTable, pDbCtx)
{
    if (_isOracleDbType(pDbCtx.dbType))
    {
        var oracleSql = ""
            + "select count(*) from all_objects "
            + "where owner = " + _sqlLiteral(_normalizeIdentifier(pSchema), pDbCtx.alias) + " "
            + " and object_name = " + _sqlLiteral(_normalizeIdentifier(pTable), pDbCtx.alias) + " "
            + " and object_type in ('TABLE', 'VIEW')";
        return _queryCount(pDbCtx.alias, oracleSql) > 0;
    }

    var mariaSql = ""
        + "select count(*) from information_schema.tables "
        + "where upper(table_schema) = " + _sqlLiteral(_normalizeIdentifier(pSchema), pDbCtx.alias) + " "
        + " and upper(table_name) = " + _sqlLiteral(_normalizeIdentifier(pTable), pDbCtx.alias);
    return _queryCount(pDbCtx.alias, mariaSql) > 0;
}

function _tableExists(pSchema, pTable, pDbCtx)
{
    if (_isOracleDbType(pDbCtx.dbType))
    {
        var oracleSql = ""
            + "select count(*) from all_tables "
            + "where owner = " + _sqlLiteral(_normalizeIdentifier(pSchema), pDbCtx.alias) + " "
            + " and table_name = " + _sqlLiteral(_normalizeIdentifier(pTable), pDbCtx.alias);
        return _queryCount(pDbCtx.alias, oracleSql) > 0;
    }

    var mariaSql = ""
        + "select count(*) from information_schema.tables "
        + "where upper(table_schema) = " + _sqlLiteral(_normalizeIdentifier(pSchema), pDbCtx.alias) + " "
        + " and upper(table_name) = " + _sqlLiteral(_normalizeIdentifier(pTable), pDbCtx.alias) + " "
        + " and table_type = 'BASE TABLE'";
    return _queryCount(pDbCtx.alias, mariaSql) > 0;
}

function _columnExists(pSchema, pTable, pColumn, pDbCtx)
{
    if (!_isNonEmptyString(pColumn))
    {
        return false;
    }

    if (_isOracleDbType(pDbCtx.dbType))
    {
        var oracleSql = ""
            + "select count(*) from all_tab_columns "
            + "where owner = " + _sqlLiteral(_normalizeIdentifier(pSchema), pDbCtx.alias) + " "
            + " and table_name = " + _sqlLiteral(_normalizeIdentifier(pTable), pDbCtx.alias) + " "
            + " and column_name = " + _sqlLiteral(_normalizeIdentifier(pColumn), pDbCtx.alias);
        return _queryCount(pDbCtx.alias, oracleSql) > 0;
    }

    var mariaSql = ""
        + "select count(*) from information_schema.columns "
        + "where upper(table_schema) = " + _sqlLiteral(_normalizeIdentifier(pSchema), pDbCtx.alias) + " "
        + " and upper(table_name) = " + _sqlLiteral(_normalizeIdentifier(pTable), pDbCtx.alias) + " "
        + " and upper(column_name) = " + _sqlLiteral(_normalizeIdentifier(pColumn), pDbCtx.alias);
    return _queryCount(pDbCtx.alias, mariaSql) > 0;
}

function _indexExists(pSchema, pTable, pIndex, pDbCtx)
{
    if (!_isNonEmptyString(pIndex))
    {
        return false;
    }

    if (_isOracleDbType(pDbCtx.dbType))
    {
        var oracleSql = ""
            + "select count(*) from all_indexes "
            + "where table_owner = " + _sqlLiteral(_normalizeIdentifier(pSchema), pDbCtx.alias) + " "
            + " and table_name = " + _sqlLiteral(_normalizeIdentifier(pTable), pDbCtx.alias) + " "
            + " and index_name = " + _sqlLiteral(_normalizeIdentifier(pIndex), pDbCtx.alias);
        return _queryCount(pDbCtx.alias, oracleSql) > 0;
    }

    var mariaSql = ""
        + "select count(*) from information_schema.statistics "
        + "where upper(table_schema) = " + _sqlLiteral(_normalizeIdentifier(pSchema), pDbCtx.alias) + " "
        + " and upper(table_name) = " + _sqlLiteral(_normalizeIdentifier(pTable), pDbCtx.alias) + " "
        + " and upper(index_name) = " + _sqlLiteral(_normalizeIdentifier(pIndex), pDbCtx.alias);
    return _queryCount(pDbCtx.alias, mariaSql) > 0;
}

function _queryCount(pAlias, pSql)
{
    var value = db.cell(pSql, pAlias);
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? 0 : parsed;
}

function _isOracleDbType(pDbType)
{
    return pDbType === "oracle";
}

function _isMariaDbType(pDbType)
{
    return pDbType === "mariadb";
}

function _resolveMetadataQueryOptions(pOptions)
{
    var options = _isObject(pOptions) ? pOptions : {};
    var detailLevel = _toLower(_readString(options.detailLevel, "fast"));
    if (detailLevel !== "fast" && detailLevel !== "full")
    {
        detailLevel = "fast";
    }

    var cacheTtlSeconds = _toPositiveInt(options.cacheTtlSeconds, Math.floor(METADATA_DEFAULT_CACHE_TTL_MS / 1000));
    var maxObjectsPerPage = _toPositiveInt(options.maxObjectsPerPage, 80);
    if (maxObjectsPerPage > 200)
    {
        maxObjectsPerPage = 200;
    }

    return {
        detailLevel: detailLevel,
        includeColumnDefaults: _readBoolean(options.includeColumnDefaults, detailLevel === "full"),
        includeColumnComments: _readBoolean(options.includeColumnComments, detailLevel === "full"),
        includeIndexExpressions: _readBoolean(options.includeIndexExpressions, detailLevel === "full"),
        matchByTableNameOnly: _readBoolean(options.matchByTableNameOnly, false),
        comparisonSchema: _isNonEmptyString(options.comparisonSchema) ? _normalizeIdentifier(options.comparisonSchema) : "__TABLE_ONLY__",
        useCache: _readBoolean(options.useCache, true),
        cacheTtlSeconds: cacheTtlSeconds,
        maxObjectsPerPage: maxObjectsPerPage
    };
}

function _normalizeTableNames(pTableNames)
{
    var result = [];
    var seen = {};
    if (!Array.isArray(pTableNames))
    {
        return result;
    }

    for (var i = 0; i < pTableNames.length; i++)
    {
        if (!_isNonEmptyString(pTableNames[i]))
        {
            continue;
        }
        var tableName = _normalizeIdentifier(pTableNames[i]);
        if (seen[tableName] === true)
        {
            continue;
        }
        seen[tableName] = true;
        result.push(tableName);
    }
    return result;
}

function _groupMetadataRowsByTable(pRows)
{
    var grouped = {};
    for (var i = 0; i < pRows.length; i++)
    {
        var tableName = _normalizeIdentifier(pRows[i].table);
        if (!Array.isArray(grouped[tableName]))
        {
            grouped[tableName] = [];
        }
        grouped[tableName].push(pRows[i]);
    }
    return grouped;
}

function _metadataColumnsCacheKey(pAlias, pSchema, pTableName, pIncludeDefaults, pIncludeComments)
{
    return _metadataCacheKey(
        pAlias,
        pSchema,
        pTableName,
        "columns",
        ["defaults=" + (pIncludeDefaults ? "1" : "0"), "comments=" + (pIncludeComments ? "1" : "0")]
    );
}

function _metadataIndexesCacheKey(pAlias, pSchema, pTableName, pIncludeSystemIndexes, pIncludeExpressions)
{
    return _metadataCacheKey(
        pAlias,
        pSchema,
        pTableName,
        "indexes",
        ["system=" + (pIncludeSystemIndexes ? "1" : "0"), "expr=" + (pIncludeExpressions ? "1" : "0")]
    );
}

function _metadataCacheKey(pAlias, pSchema, pTableName, pKind, pFlags)
{
    var flags = Array.isArray(pFlags) ? pFlags.join("|") : "";
    return [
        _readString(pAlias, ""),
        _normalizeIdentifier(pSchema),
        _normalizeIdentifier(pTableName),
        _readString(pKind, ""),
        flags
    ].join("|");
}

function _metadataCacheGet(pCacheType, pKey)
{
    var cache = METADATA_CACHE[pCacheType];
    if (!_isObject(cache) || !cache[pKey])
    {
        return null;
    }

    if (cache[pKey].expiresAt <= new Date()
        .getTime())
    {
        delete cache[pKey];
        return null;
    }

    return _deepClone(cache[pKey].data);
}

function _metadataCachePut(pCacheType, pKey, pData, pTtlMs)
{
    var cache = METADATA_CACHE[pCacheType];
    if (!_isObject(cache))
    {
        return;
    }

    var ttlMs = _toPositiveInt(pTtlMs, METADATA_DEFAULT_CACHE_TTL_MS);
    cache[pKey] = {
        expiresAt: new Date()
            .getTime() + ttlMs,
        data: _deepClone(pData)
    };
}

function _deepClone(pValue)
{
    if (!_hasValue(pValue))
    {
        return pValue;
    }
    return JSON.parse(JSON.stringify(pValue));
}

function _compareIdentifier(pLeft, pRight)
{
    var left = _normalizeIdentifier(pLeft);
    var right = _normalizeIdentifier(pRight);
    if (left < right)
    {
        return -1;
    }
    if (left > right)
    {
        return 1;
    }
    return 0;
}

function _chunkArray(pItems, pChunkSize)
{
    var chunkSize = _toPositiveInt(pChunkSize, 40);
    var chunks = [];
    for (var i = 0; i < pItems.length; i += chunkSize)
    {
        chunks.push(pItems.slice(i, i + chunkSize));
    }
    return chunks;
}

function _rewriteMetadataSchemaForComparison(pTables, pColumns, pIndexes, pComparisonSchema)
{
    var comparisonSchema = _normalizeIdentifier(_readString(pComparisonSchema, "__TABLE_ONLY__"));
    var i;

    for (i = 0; i < pTables.length; i++)
    {
        pTables[i].schema = comparisonSchema;
    }

    for (i = 0; i < pColumns.length; i++)
    {
        pColumns[i].schema = comparisonSchema;
    }

    for (i = 0; i < pIndexes.length; i++)
    {
        pIndexes[i].schema = comparisonSchema;
    }
}
