const axios = require('axios');
require('dotenv').config();

class GeminiService {
    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY || process.env.Gemini_API_Key;
        // 매뉴얼에 따른 올바른 엔드포인트 사용
        this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
        this.openAICompatUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    }

    /**
     * GEMINI API를 호출하여 텍스트 생성 (OpenAI 호환 방식)
     * @param {string} prompt - 생성할 프롬프트
     * @param {object} options - 추가 옵션
     * @returns {Promise<string>} 생성된 텍스트
     */
    async generateText(prompt, options = {}) {
        try {
            console.log('=== GEMINI API 호출 시작 ===');
            console.log('API URL:', this.baseUrl);
            
            // API 키 검증
            if (!this.apiKey) {
                throw new Error('Gemini API 키가 설정되지 않았습니다. 환경변수를 확인하세요.');
            }
            
            console.log('API Key:', this.apiKey.substring(0, 10) + '...');
            
            const requestBody = {
                contents: [{
                    role: "user",
                    parts: [{
                        text: `당신은 부동산 CRM 시스템의 AI 어시스턴트입니다. 한국어로 친근하고 전문적인 톤으로 응답해주세요.\n\n${prompt}`
                    }]
                }],
                generationConfig: {
                    temperature: options.temperature ?? 0.7,
                    topK: options.topK ?? 32,
                    topP: options.topP ?? 0.9,
                    maxOutputTokens: options.maxOutputTokens ?? 1200,
                }
            };

            console.log('요청 본문:', JSON.stringify(requestBody, null, 2));

            // 재시도 로직 (네이티브 엔드포인트)
            const maxRetries = 2;
            let lastError;
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    const response = await axios.post(
                        `${this.baseUrl}?key=${this.apiKey}`,
                        requestBody,
                        {
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            timeout: 300000 // 5분 타임아웃 (더 여유있게)
                        }
                    );

                    console.log('응답 상태:', response.status);
                    console.log('응답 데이터:', JSON.stringify(response.data, null, 2));

                    if (response.data && response.data.candidates && response.data.candidates[0]) {
                        const parts = response.data.candidates[0].content?.parts || [];
                        const result = parts.map(p => p.text || '').join('\n').trim();
                        console.log('생성된 텍스트:', result.substring(0, 100) + '...');
                        return result;
                    } else {
                        console.error('응답 형식 오류:', response.data);
                        throw new Error('GEMINI API 응답 형식이 올바르지 않습니다.');
                    }
                } catch (err) {
                    lastError = err;
                    const isTimeout = err.code === 'ECONNABORTED' || /timeout/i.test(err.message);
                    const status = err.response?.status;
                    console.warn(`네이티브 호출 실패 (시도 ${attempt + 1}/${maxRetries + 1}) - status=${status || 'n/a'} timeout=${isTimeout}`);
                    if (attempt < maxRetries) {
                        const backoffMs = 500 * Math.pow(2, attempt);
                        await new Promise(r => setTimeout(r, backoffMs));
                        continue;
                    }
                }
            }

            // 폴백: OpenAI 호환 엔드포인트로 재시도
            console.warn('네이티브 엔드포인트 실패. OpenAI 호환 엔드포인트로 폴백합니다.');
            const oaBody = {
                model: 'gemini-2.5-flash',
                messages: [
                    { role: 'system', content: '당신은 부동산 CRM 시스템의 AI 어시스턴트입니다. 한국어로 친근하고 전문적인 톤으로 응답해주세요.' },
                    { role: 'user', content: prompt }
                ],
                temperature: requestBody.generationConfig.temperature,
                top_p: requestBody.generationConfig.topP,
                max_tokens: requestBody.generationConfig.maxOutputTokens
            };
            const oaResp = await axios.post(
                this.openAICompatUrl,
                oaBody,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`
                    },
                    timeout: 90000
                }
            );
            const choice = oaResp.data?.choices?.[0]?.message?.content;
            if (!choice) {
                throw lastError || new Error('GEMINI OpenAI 호환 응답 형식 오류');
            }
            return choice;
        } catch (error) {
            console.error('=== GEMINI API 호출 오류 ===');
            console.error('오류 타입:', error.constructor.name);
            console.error('오류 메시지:', error.message);
            
            if (error.response) {
                console.error('응답 상태:', error.response.status);
                console.error('응답 헤더:', error.response.headers);
                console.error('응답 데이터:', error.response.data);
                throw new Error(`GEMINI API 오류 (${error.response.status}): ${JSON.stringify(error.response.data)}`);
            } else if (error.request) {
                console.error('요청 정보:', error.request);
                throw new Error('GEMINI API 서버에 연결할 수 없습니다.');
            } else {
                console.error('기타 오류:', error);
                throw new Error(`GEMINI API 호출 중 오류가 발생했습니다: ${error.message}`);
            }
        }
    }

    /**
     * 금주 업무리스트 브리핑 생성
     * @param {Array} schedules - 일정 목록
     * @param {string} userName - 사용자 이름
     * @returns {Promise<string>} 브리핑 텍스트
     */
    async generateWeeklyBriefing(schedules, userName) {
        // 전체 데이터 전송 (더 상세한 분석을 위해)
        const fullData = schedules.map(s => ({
            _id: s._id,
            title: s.title,
            type: s.type,
            date: s.date,
            time: s.time,
            location: s.location,
            description: s.description,
            priority: s.priority,
            status: s.status,
            relatedCustomers: (s.relatedCustomers || []).map(c => ({ 
                _id: c._id,
                name: c.name, 
                phone: c.phone,
                email: c.email 
            })),
            relatedProperties: (s.relatedProperties || []).map(p => ({
                _id: p._id,
                title: p.title,
                address: p.address
            })),
            relatedContracts: s.relatedContracts || [],
            publisher: s.publisher ? {
                _id: s.publisher._id,
                name: s.publisher.name,
                email: s.publisher.email,
                level: s.publisher.level
            } : null,
            byCompanyNumber: s.byCompanyNumber,
            createdAt: s.createdAt
        }));

        const prompt = `
사용자 "${userName}"의 이번 주 일정을 분석하여 상세한 업무 브리핑을 작성하세요.

전체 일정 데이터(JSON):
${JSON.stringify(fullData, null, 2)}

다음 형식으로 상세한 브리핑을 작성해주세요:

## 📅 이번 주 업무 브리핑

### 🎯 주요 업무 목표
- 핵심 업무와 우선순위를 정리해주세요
- 고객별 특별 요구사항 분석

### 📋 일정별 상세 분석
각 일정에 대해:
- 업무 유형과 중요도
- 고객의 구체적인 요구사항 (description 필드 참조)
- 관련 매물 정보 분석
- 준비사항과 주의점
- 예상 소요시간

### 👥 만나는 사람들
- 고객/파트너 정보와 만남 목적
- 고객의 구체적인 예산 및 조건 분석
- 각 만남에서 중점적으로 다룰 내용
- 관련 매물과의 연관성

### 💡 성공을 위한 팁
- 고객의 예산과 조건에 맞는 맞춤형 조언
- 효율적인 업무 진행을 위한 조언
- 고객 만족도를 높이는 방법
- 매물 추천 전략

### ⚠️ 주의사항
- 특별히 주의해야 할 점들
- 고객의 특별한 요구사항 고려사항
- 계약 진행 시 주의점

한국어로 친근하고 전문적인 톤으로 작성해주세요.
`;

        return await this.generateText(prompt, {
            temperature: 0.7,
            maxOutputTokens: 3000
        });
    }

    /**
     * 만나는 사람에 대한 메시지 추천 생성
     * @param {Object} schedule - 일정 정보
     * @param {Object} customer - 고객 정보
     * @returns {Promise<string>} 추천 메시지
     */
    async generateMeetingMessage(schedule, customer) {
        const prompt = `
당신은 부동산 CRM 시스템의 AI 어시스턴트입니다.
고객과의 만남 전에 보낼 적절한 메시지를 추천해주세요.

일정 정보:
- 제목: ${schedule.title}
- 유형: ${schedule.type}
- 날짜: ${schedule.date}
- 시간: ${schedule.time}
- 장소: ${schedule.location}
- 설명: ${schedule.description || '없음'}
- 우선순위: ${schedule.priority}
- 상태: ${schedule.status}

고객 정보:
- 이름: ${customer.name}
- 연락처: ${customer.phone}
- 이메일: ${customer.email || '없음'}

관련 매물 정보:
${schedule.relatedProperties && schedule.relatedProperties.length > 0 
    ? schedule.relatedProperties.map(p => `- ${p.title} (${p.address})`).join('\n')
    : '관련 매물 없음'
}

다음 형식으로 메시지를 작성해주세요:

## 📱 추천 메시지

### 📞 전화 통화용 (간단한 확인)
"안녕하세요, [고객명]님! 내일 [시간]에 [장소]에서 만나기로 한 약속 확인차 연락드립니다. 혹시 시간이나 장소에 변경사항이 있으시면 말씀해 주세요. 내일 뵙겠습니다!"

### 💬 문자 메시지용 (상세한 안내)
"안녕하세요, [고객명]님! 내일 [날짜] [시간]에 [장소]에서 [업무유형] 관련 상담 예정입니다. 준비해주신 자료나 궁금한 점이 있으시면 미리 말씀해 주세요. 내일 뵙겠습니다! 😊"

### 📧 이메일용 (공식적인 안내)
"제목: [날짜] [업무유형] 상담 일정 안내

[고객명]님 안녕하세요.

내일 [날짜] [시간]에 [장소]에서 [업무유형] 관련 상담을 진행할 예정입니다.

상담 준비사항:
- [준비사항 1]
- [준비사항 2]

문의사항이 있으시면 언제든 연락주세요.
감사합니다."

각 메시지는 고객의 상황과 업무 유형에 맞게 조정해주세요.
친근하면서도 전문적인 톤을 유지해주세요.
`;

        return await this.generateText(prompt, {
            temperature: 0.65,
            maxOutputTokens: 1000
        });
    }

    /**
     * 일정 분석 및 조언 생성
     * @param {Array} schedules - 일정 목록
     * @returns {Promise<string>} 분석 및 조언 텍스트
     */
    async generateScheduleAnalysis(schedules) {
        // 전체 데이터 전송 (더 상세한 분석을 위해)
        const fullData = schedules.map(s => ({
            _id: s._id,
            title: s.title,
            type: s.type,
            date: s.date,
            time: s.time,
            location: s.location,
            description: s.description,
            priority: s.priority,
            status: s.status,
            relatedCustomers: (s.relatedCustomers || []).map(c => ({ 
                _id: c._id,
                name: c.name, 
                phone: c.phone,
                email: c.email 
            })),
            relatedProperties: (s.relatedProperties || []).map(p => ({
                _id: p._id,
                title: p.title,
                address: p.address
            })),
            relatedContracts: s.relatedContracts || [],
            publisher: s.publisher ? {
                _id: s.publisher._id,
                name: s.publisher.name,
                level: s.publisher.level
            } : null,
            createdAt: s.createdAt
        }));

        const prompt = `
당신은 부동산 전문가이자 개인 코치입니다. 사용자의 일정을 분석하여 매우 구체적이고 개인적인 업무 관리 조언을 제공하세요.

📋 전체 일정 상세 데이터:
${JSON.stringify(fullData, null, 2)}

🎯 다음 형식으로 매우 상세하고 개인적인 분석 보고서를 작성해주세요:

## 📊 맞춤형 일정 분석 및 성공 전략 보고서

### 🔍 업무 패턴 심층 분석
- 업무 유형별 분포 및 각 유형의 비즈니스 임팩트 분석
- 시간대별 업무 밀도와 효율성 패턴 분석
- 우선순위별 업무 분포와 성과 연관성 분석
- 고객별 상담 패턴과 성공 요인 분석

### 💡 개인 맞춤 업무 전략
- 사용자만을 위한 특별한 업무 최적화 전략
- 고객별 맞춤 접근법 (구체적인 대화 주제와 질문 제안)
- 매물별 차별화된 마케팅 전략
- 계약 성사율을 높이는 실전 팁과 스크립트

### ⏰ 시간 관리 혁신 방안
- 효율적인 시간 배치와 우선순위 설정
- 이동 시간 최적화와 업무 연계 전략
- 휴식 시간 활용과 에너지 관리
- 업무 집중도 극대화 방안

### 🎯 고객별 맞춤 전략 (실전 가이드)
각 고객에 대해:
- 고객의 심리 상태와 구매 의도 심층 분석
- 맞춤형 상담 접근법과 대화 스크립트
- 구체적인 질문 리스트와 답변 전략
- 거래 성사 가능성과 구체적 실행 계획

### 🏠 매물별 마케팅 전략 (차별화 포인트)
각 매물에 대해:
- 매물의 강점과 약점 심층 분석
- 타겟 고객층과 맞춤 마케팅 포인트
- 차별화 포인트와 어필 방법
- 가격 전략과 협상 포인트

### ⚡ 실전 성공 팁 (즉시 적용 가능)
- 업무 효율성 극대화 방법
- 고객 만족도를 높이는 구체적 방법
- 경쟁사 대비 우위 전략
- 장기적 고객 관계 구축 방안

### 🔄 혁신적 개선 제안사항
- 일정 최적화와 업무 프로세스 개선
- 업무 효율성 향상 방법
- 고객 만족도 향상 방안
- 스트레스 관리와 워라밸 개선
- 시스템 활용 최적화 방안

### 🚨 리스크 관리 및 대응 전략
- 각 일정에서 주의해야 할 구체적 점들
- 잠재적 문제점과 대응 방안
- 법적/윤리적 고려사항
- 백업 플랜과 대안 제시

### 📈 성과 예측 및 목표 설정
- 목표 달성 가능성과 예상 수익 분석
- 성과 지표와 측정 방법
- 단기/장기 목표 달성을 위한 단계별 계획
- 지속적인 성장을 위한 개선 방향

각 조언은 구체적이고 실행 가능해야 하며, 사용자의 개인적 상황과 업무 환경을 고려한 맞춤형 내용이어야 합니다.
한국어로 전문적이고 실용적인 조언을 제공해주세요.
`;

        return await this.generateText(prompt, {
            temperature: 0.6,
            maxOutputTokens: 2000
        });
    }

    /**
     * 주간 브리핑 생성
     * @param {Array} schedules - 일정 배열
     * @param {string} userName - 사용자 이름
     * @returns {Promise<string>} 생성된 브리핑
     */
    async generateWeeklyBriefing(schedules, userName) {
        // 일정 데이터를 더 상세하게 준비
        const detailedSchedules = schedules.map(s => ({
            title: s.title,
            date: s.date,
            time: s.time,
            type: s.type,
            priority: s.priority,
            status: s.status,
            description: s.description,
            location: s.location,
            publisher: s.publisher?.name,
            customers: s.relatedCustomers?.map(c => ({
                name: c.name,
                phone: c.phone,
                email: c.email
            })),
            properties: s.relatedProperties?.map(p => ({
                title: p.title,
                address: p.address
            })),
            contracts: s.relatedContracts?.map(c => ({
                contractNumber: c.contractNumber,
                type: c.type,
                status: c.status
            }))
        }));

        const prompt = `
당신은 부동산 전문가이자 개인 코치입니다. 사용자 "${userName}"의 이번 주 일정을 분석하여 매우 구체적이고 개인적인 조언을 제공해주세요.

📋 일정 상세 데이터:
${JSON.stringify(detailedSchedules, null, 2)}

🎯 다음 형식으로 매우 상세하고 개인적인 주간 브리핑을 작성해주세요:

## 📅 ${userName}님의 이번 주 맞춤 업무 브리핑

### 🔍 일정 심층 분석
- 각 일정의 비즈니스 임팩트 분석
- 고객별 특성과 니즈 파악
- 매물/계약의 전략적 가치 평가
- 시간대별 업무 효율성 분석

### 💡 개인 맞춤 조언
- ${userName}님만을 위한 특별한 업무 전략
- 고객별 맞춤 접근법 (구체적인 대화 주제 제안)
- 매물별 차별화된 마케팅 전략
- 계약 성사율을 높이는 실전 팁

### 🎯 고객별 맞춤 전략
각 고객에 대해:
- 고객의 심리 상태와 구매 의도 분석
- 맞춤형 상담 접근법
- 구체적인 질문 리스트 제안
- 거래 성사 가능성과 전략

### 🏠 매물별 마케팅 전략
각 매물에 대해:
- 매물의 강점과 약점 분석
- 타겟 고객층 제안
- 차별화 포인트 제시
- 가격 전략 조언

### ⚡ 실전 성공 팁
- ${userName}님의 업무 스타일에 맞는 효율성 개선안
- 고객 만족도를 극대화하는 방법
- 경쟁사 대비 우위 전략
- 장기적 고객 관계 구축 방안

### 🚨 주의사항 및 리스크 관리
- 각 일정에서 주의해야 할 점들
- 잠재적 문제점과 대응 방안
- 법적/윤리적 고려사항
- 백업 플랜 제안

### 📈 성과 예측 및 목표 설정
- 이번 주 목표 달성 가능성
- 예상 수익 및 성과 지표
- 다음 주를 위한 준비사항
- 장기 목표 달성을 위한 단계별 계획

각 조언은 구체적이고 실행 가능해야 하며, ${userName}님의 개인적 상황과 업무 환경을 고려한 맞춤형 내용이어야 합니다.
한국어로 친근하면서도 전문적인 톤으로 작성해주세요.
`;

        return await this.generateText(prompt, {
            temperature: 0.8,
            maxOutputTokens: 3000
        });
    }
}

module.exports = new GeminiService();
