#!/usr/bin/env node
'use strict';

const { info: logInfo } = require('../../../packages/observability/src/logger');
const { createGisService } = require('./service');
const app=createGisService();
app.server.listen(app.port,app.host,()=>logInfo('fiberos_gis_listening',{port:app.port,bindHost:app.host,authority:'FIBEROS_DATABASE_POSTGIS',executionAuthorized:false}));
