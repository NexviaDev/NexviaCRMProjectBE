// Deprecation 경고 억제
process.removeAllListeners('warning');

const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const indexRouter = require('./routes/index');
require('dotenv').config();

// 환경 변수 설정
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://app.nexvia2.co.kr';
const CORS_ORIGIN = process.env.CORS_ORIGIN || FRONTEND_URL;
const ENABLE_HTTPS_REDIRECT = (process.env.ENABLE_HTTPS_REDIRECT || 'true').toLowerCase() === 'true';

// 개발 환경 로그
if (NODE_ENV === 'development') {
  console.log('🧪 개발 환경으로 실행 중입니다.');
  console.log('🧪 테스트용 스케줄러가 1분마다 실행됩니다.');
}

// MongoDB 연결 문자열 구성
const MONGODB_USER = process.env.MONGODB_USER || 'Rancho';
const MONGODB_PASS = process.env.MONGODB_PASS || 'yVwzcI9b8q9gEKES';
const MONGODB_CLUSTER = process.env.MONGODB_CLUSTER || 'nexviacrmproject.1muago.mongodb.net';
const MONGODB_DB = process.env.MONGODB_DB || 'nexviacrmproject';

const MONGODB_URI_PROD = process.env.MONGODB_URI_PROD || 
    `mongodb+srv://${MONGODB_USER}:${MONGODB_PASS}@${MONGODB_CLUSTER}/${MONGODB_DB}?retryWrites=true&w=majority&appName=nexviacrmproject`;
const app = express();

// 프록시(Cloudflare/Nginx) 뒤에 있을 때 클라이언트 IP/프로토콜 신뢰
app.set('trust proxy', 1);

// 미들웨어 설정
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// HTTPS 전용 CORS (크리덴셜 허용)
app.use(cors({
  origin: (origin, callback) => {
    // 서버-사이드 호출(origin 없음) 또는 명시 오리진 허용
    if (!origin || origin === CORS_ORIGIN) return callback(null, true);
    
    // 개발 환경에서 localhost 허용
    if (NODE_ENV === 'development') {
      const devOrigins = [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3001'
      ];
      if (devOrigins.includes(origin)) return callback(null, true);
    }
    
    // 프로덕션 환경에서 nexvia2.co.kr 도메인 허용
    if (NODE_ENV === 'production') {
      const prodOrigins = [
        'https://app.nexvia2.co.kr',
        'https://www.nexvia2.co.kr',
        'https://nexvia2.co.kr',
        'https://api.nexvia2.co.kr',
        'https://admin.nexvia2.co.kr',
        'https://m.nexvia2.co.kr',
        'https://subtle-sopapillas-cd51dc.netlify.app',
        'https://rancho-crm-project-05d4c046d65b.herokuapp.com'
      ];
      if (prodOrigins.includes(origin)) return callback(null, true);
    }
    
    // Google OAuth 관련 도메인 허용
    const allowedOrigins = [
      CORS_ORIGIN,
      'https://accounts.google.com',
      'https://oauth2.googleapis.com',
      'https://www.googleapis.com'
    ];
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// 보안 헤더 및 HSTS (프로덕션에서만 강제)
app.use((req, res, next) => {
  // MIME 스니핑 방지
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // 클릭재킹 방지
  res.setHeader('X-Frame-Options', 'DENY');
  // XSS 필터 힌트(레거시)
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // 참조자 최소화
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (NODE_ENV === 'production') {
    // 1년, 서브도메인 포함, 프리로드(사전 검증 후 사용 권장)
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
});

// HTTP -> HTTPS 리다이렉트 (프로덕션, 프록시 헤더 기준)
if (NODE_ENV === 'production' && ENABLE_HTTPS_REDIRECT) {
  app.use((req, res, next) => {
    const xfProto = req.headers['x-forwarded-proto'];
    if (xfProto && xfProto !== 'https') {
      const host = req.headers.host;
      return res.redirect(301, `https://${host}${req.originalUrl}`);
    }
    next();
  });
}

// 요청 타임아웃 설정 (2분)
app.use((req, res, next) => {
    req.setTimeout(120000); // 2분
    res.setTimeout(120000); // 2분
    next();
});

// 기본 라우트 설정 (가장 먼저 정의)
app.get('/', (req, res) => {
    res.json({
        status: 'success',
        message: 'Nexvia CRM Backend API Server',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
            health: '/api/health',
            testDb: '/api/test-db',
            users: '/api/user',
            auth: '/api/auth'
        }
    });
});

// 헬스 체크 엔드포인트
app.get('/api/health', (req, res) => {
    const dbState = mongoose.connection.readyState;
    const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    
    res.json({
        status: 'success',
        server: 'running',
        database: {
            state: dbState,
            stateName: dbStates[dbState],
            connected: dbState === 1
        },
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// 정적 파일 제공
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 마이그레이션 함수들
const runMigrations = async () => {
    try {
        
        
        // 1. 계약 매물 필드 마이그레이션
        const Contract = require('./models/Contract.model');
        const contractsWithStringProperty = await Contract.find({
            property: { $type: "string" }
        });
        
        if (contractsWithStringProperty.length > 0) {
    
            for (const contract of contractsWithStringProperty) {
                try {
                    const propertyObjectId = new mongoose.Types.ObjectId(contract.property);
                    await Contract.findByIdAndUpdate(contract._id, {
                        $set: { property: propertyObjectId }
                    });
                    console.log(`계약 ID ${contract._id}의 property 필드 변환 완료`);
                } catch (error) {
                    console.error(`계약 ID ${contract._id} 변환 실패:`, error.message);
                }
            }
        }
        
        // 2. 매물 계약 기간 필드 마이그레이션
        const Property = require('./models/Property.model');
        const propertiesWithoutContractPeriod = await Property.find({
            $or: [
                { contractPeriod: { $exists: false } },
                { contractPeriod: null }
            ]
        });
        
        if (propertiesWithoutContractPeriod.length > 0) {
            console.log(`${propertiesWithoutContractPeriod.length}개의 매물에 contractPeriod 필드를 추가합니다...`);
            for (const property of propertiesWithoutContractPeriod) {
                await Property.findByIdAndUpdate(property._id, {
                    $set: {
                        contractPeriod: {
                            startDate: null,
                            endDate: null
                        }
                    }
                });
                console.log(`매물 ID ${property._id}에 contractPeriod 필드 추가 완료`);
            }
        }
        
        // 3. 고객 매물 필드 마이그레이션 (필요한 경우)
        const Customer = require('./models/Customer.model');
        const customersWithoutProperties = await Customer.find({
            $or: [
                { properties: { $exists: false } },
                { properties: null }
            ]
        });
        
        if (customersWithoutProperties.length > 0) {
            console.log(`${customersWithoutProperties.length}개의 고객에 properties 필드를 추가합니다...`);
            for (const customer of customersWithoutProperties) {
                await Customer.findByIdAndUpdate(customer._id, {
                    $set: { properties: [] }
                });
                console.log(`고객 ID ${customer._id}에 properties 필드 추가 완료`);
            }
        }
        
        // 4. 사용자 직급 필드 마이그레이션
        const User = require('./models/user.model');
        const usersWithoutPosition = await User.find({
            $or: [
                { position: { $exists: false } },
                { position: null },
                { position: '' }
            ]
        });
        
        if (usersWithoutPosition.length > 0) {
            console.log(`📊 ${usersWithoutPosition.length}명의 사용자에 직급 필드를 추가합니다...`);
            for (const user of usersWithoutPosition) {
                await User.findByIdAndUpdate(user._id, {
                    $set: { position: '사원' } // 기본값으로 '사원' 설정
                });
                console.log(`✅ 사용자 ${user.email}에게 직급 '사원' 설정 완료`);
            }
            console.log(`🎉 총 ${usersWithoutPosition.length}명의 사용자 직급 정보가 업데이트되었습니다.`);
        } else {
            console.log('✅ 모든 사용자가 이미 직급 정보를 가지고 있습니다.');
        }
        
        // 직급별 사용자 수 통계 출력
        const positionStats = await User.aggregate([
            {
                $group: {
                    _id: '$position',
                    count: { $sum: 1 }
                }
            },
            {
                $sort: { count: -1 }
            }
        ]);
        
        console.log('📊 직급별 사용자 수:');
        positionStats.forEach(stat => {
            console.log(`   ${stat._id || '미설정'}: ${stat.count}명`);
        });
        
        // 5. 고객 schedules 필드 마이그레이션
        const customersWithoutSchedules = await Customer.find({
            $or: [
                { schedules: { $exists: false } },
                { schedules: null }
            ]
        });
        
        if (customersWithoutSchedules.length > 0) {
            console.log(`📅 ${customersWithoutSchedules.length}명의 고객에 schedules 필드를 추가합니다...`);
            for (const customer of customersWithoutSchedules) {
                await Customer.findByIdAndUpdate(customer._id, {
                    $set: { schedules: [] }
                });
                console.log(`✅ 고객 ID ${customer._id} (${customer.name})에 schedules 필드 추가 완료`);
            }
            console.log(`🎉 총 ${customersWithoutSchedules.length}명의 고객 schedules 정보가 업데이트되었습니다.`);
        } else {
            console.log('✅ 모든 고객이 이미 schedules 필드를 가지고 있습니다.');
        }
        
        // 기존 일정 데이터를 기반으로 고객의 schedules 배열 업데이트
        const Schedule = require('./models/Schedule.model');
        const existingSchedules = await Schedule.find({
            relatedCustomer: { $exists: true, $ne: null }
        }).populate('relatedCustomer', '_id name');
        
        if (existingSchedules.length > 0) {
            console.log(`🔄 ${existingSchedules.length}개의 기존 일정을 기반으로 고객 schedules 배열을 업데이트합니다...`);
            
            for (const schedule of existingSchedules) {
                if (schedule.relatedCustomer) {
                    try {
                        // 이미 schedules 배열에 해당 일정이 있는지 확인
                        const customer = await Customer.findById(schedule.relatedCustomer._id);
                        const scheduleExists = customer.schedules.some(s => s.schedule.toString() === schedule._id.toString());
                        
                        if (!scheduleExists) {
                            await Customer.findByIdAndUpdate(
                                schedule.relatedCustomer._id,
                                {
                                    $push: {
                                        schedules: {
                                            schedule: schedule._id,
                                            addedAt: schedule.createdAt || new Date()
                                        }
                                    }
                                }
                            );
                            console.log(`✅ 고객 ${schedule.relatedCustomer.name}의 schedules에 기존 일정 ${schedule.title} 추가 완료`);
                        }
                    } catch (error) {
                        console.error(`❌ 고객 ${schedule.relatedCustomer.name}의 schedules 업데이트 실패:`, error.message);
                    }
                }
            }
            console.log('🎉 기존 일정 기반 고객 schedules 배열 업데이트가 완료되었습니다.');
        }

        // 6. 기존 schedules 배열에서 불필요한 _id 필드 제거
        const customersWithSchedules = await Customer.find({
            'schedules._id': { $exists: true }
        });
        
        if (customersWithSchedules.length > 0) {
            console.log(`🧹 ${customersWithSchedules.length}명의 고객에서 schedules 배열의 불필요한 _id 필드를 제거합니다...`);
            
            for (const customer of customersWithSchedules) {
                try {
                    const updatedSchedules = customer.schedules.map(schedule => ({
                        schedule: schedule.schedule,
                        addedAt: schedule.addedAt
                    }));
                    
                    await Customer.findByIdAndUpdate(customer._id, {
                        $set: { schedules: updatedSchedules }
                    });
                    console.log(`✅ 고객 ${customer.name}의 schedules 배열 정리 완료`);
                } catch (error) {
                    console.error(`❌ 고객 ${customer.name}의 schedules 배열 정리 실패:`, error.message);
                }
            }
            console.log('🎉 schedules 배열 정리가 완료되었습니다.');
        }
        
        // 7. Schedule 모델의 relatedCustomers, relatedProperties 배열 필드 추가
        console.log('🔄 Schedule 모델에 relatedCustomers, relatedProperties 배열 필드를 추가합니다...');
        
        try {
            // 기존 일정 데이터를 새로운 배열 필드로 마이그레이션
            const schedulesToUpdate = await Schedule.find({
                $or: [
                    { relatedCustomer: { $exists: true, $ne: null } },
                    { relatedProperty: { $exists: true, $ne: null } }
                ]
            });
            
            if (schedulesToUpdate.length > 0) {
                console.log(`🔄 ${schedulesToUpdate.length}개의 기존 일정을 새로운 배열 필드로 마이그레이션합니다...`);
                
                for (const schedule of schedulesToUpdate) {
                    const updateData = {};
                    
                    // relatedCustomer가 있으면 relatedCustomers 배열에 추가
                    if (schedule.relatedCustomer) {
                        updateData.relatedCustomers = [schedule.relatedCustomer];
                    }
                    
                    // relatedProperty가 있으면 relatedProperties 배열에 추가
                    if (schedule.relatedProperty) {
                        updateData.relatedProperties = [schedule.relatedProperty];
                    }
                    
                    if (Object.keys(updateData).length > 0) {
                        await Schedule.findByIdAndUpdate(schedule._id, updateData);
                        console.log(`✅ 일정 ${schedule.title}의 배열 필드 마이그레이션 완료`);
                    }
                }
                console.log('🎉 Schedule 모델 배열 필드 마이그레이션이 완료되었습니다.');
            }
        } catch (error) {
            console.error('❌ Schedule 모델 배열 필드 마이그레이션 실패:', error.message);
        }
        
        console.log('모든 마이그레이션이 완료되었습니다!');
        
    } catch (error) {
        console.error('마이그레이션 중 오류가 발생했습니다:', error);
    }
};

// MongoDB 연결
console.log('🔍 MongoDB 연결 문자열:', MONGODB_URI_PROD ? '설정됨' : '설정되지 않음');
console.log('🔍 MongoDB 데이터베이스:', MONGODB_DB);
console.log('🔍 MongoDB 클러스터:', MONGODB_CLUSTER);

mongoose.connect(MONGODB_URI_PROD, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000, // 5초로 단축
    socketTimeoutMS: 10000, // 10초로 단축
    connectTimeoutMS: 10000, // 연결 타임아웃 추가
    maxPoolSize: 10, // 최대 연결 풀 크기
    minPoolSize: 1, // 최소 연결 풀 크기
    maxIdleTimeMS: 30000, // 유휴 연결 타임아웃
    bufferMaxEntries: 0, // 버퍼링 비활성화
    bufferCommands: false, // 명령 버퍼링 비활성화
})
    .then(() => { 
        console.log("✅ MongoDB Connected Successfully");
        console.log("📊 Database:", mongoose.connection.name);
    })
    .catch((err) => { 
        console.error("❌ MongoDB Connection Failed:", err.message);
        console.error("🔍 Connection String:", MONGODB_URI_PROD ? "설정됨" : "설정되지 않음");
    });

// PayPal 결제 주문 생성

// API 라우트 설정
app.use("/api", (req, res, next) => {
    // MongoDB 연결 상태 확인 (API 요청에만 적용)
    const dbState = mongoose.connection.readyState;
    const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    
    console.log(`🔍 API 요청 - DB 상태 체크: ${dbStates[dbState]} (${dbState})`);
    
    if (dbState !== 1) {
        console.error('⚠️ MongoDB 연결 상태:', dbState);
        console.error('⚠️ 연결 상태 설명:', dbStates[dbState]);
        console.error('⚠️ 연결 호스트:', mongoose.connection.host);
        console.error('⚠️ 연결 포트:', mongoose.connection.port);
        
        return res.status(503).json({ 
            status: 'fail', 
            message: '데이터베이스 연결이 불안정합니다. 잠시 후 다시 시도해주세요.',
            dbStatus: dbState,
            dbStateName: dbStates[dbState]
        });
    }
    next();
}, indexRouter);

// MongoDB 연결 테스트 엔드포인트
app.get('/api/test-db', async (req, res) => {
    try {
        const dbState = mongoose.connection.readyState;
        const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
        
        // 간단한 데이터베이스 쿼리 테스트
        const User = require('./models/user.model');
        const userCount = await User.countDocuments({});
        
        res.json({
            status: 'success',
            dbConnection: {
                state: dbState,
                stateName: dbStates[dbState],
                host: mongoose.connection.host,
                port: mongoose.connection.port,
                name: mongoose.connection.name
            },
            testQuery: {
                userCount: userCount,
                success: true
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message,
            dbConnection: {
                state: mongoose.connection.readyState,
                stateName: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState]
            }
        });
    }
});

// 정기구독 스케줄러 연결
const subscriptionScheduler = require('./schedulers/subscriptionScheduler');

// 서버 시작 후 스케줄러 시작
app.listen(PORT, () => {
  console.log(`🚀 서버가 포트 ${PORT}에서 실행 중입니다.`);
  console.log(`🌐 서버 URL: http://localhost:${PORT}`);
  console.log(`📊 MongoDB 상태: ${mongoose.connection.readyState}`);
  console.log(`🔗 등록된 라우트:`);
  console.log(`   - GET  /`);
  console.log(`   - GET  /api/health`);
  console.log(`   - GET  /api/test-db`);
  console.log(`   - POST /api/user/*`);
  
  // 정기구독 스케줄러 시작
  try {
    subscriptionScheduler.start();
    console.log(`⏰ 스케줄러 시작됨`);
  } catch (error) {
    console.error(`❌ 스케줄러 시작 실패:`, error.message);
  }
});





/////////////////////////////
