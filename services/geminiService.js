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
                    topP: options.topP ?? 0.9
                    // 토큰 제한 완전 제거 - 무제한 생성
                }
            };

            console.log('요청 본문:', JSON.stringify(requestBody, null, 2));

            // 재시도 로직 (네이티브 엔드포인트)
            const maxRetries = 5; // 재시도 횟수 증가
            let lastError;
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    const response = await axios.post(
                        `${this.baseUrl}?key=${this.apiKey}`,
                        requestBody,
                        {
                            headers: {
                                'Content-Type': 'application/json',
                            }
                            // 타임아웃 완전 제거 - 무제한 대기
                        }
                    );

                    console.log('응답 상태:', response.status);
                    console.log('응답 데이터:', JSON.stringify(response.data, null, 2));

                    if (response.data && response.data.candidates && response.data.candidates[0]) {
                        const candidate = response.data.candidates[0];
                        const parts = candidate.content?.parts || [];
                        const result = parts.map(p => p.text || '').join('\n').trim();
                        
                        // 응답 완성도 확인
                        const finishReason = candidate.finishReason;
                        console.log('응답 완성 상태:', finishReason);
                        console.log('생성된 텍스트 길이:', result.length);
                        console.log('생성된 텍스트 미리보기:', result.substring(0, 200) + '...');
                        
                        // 응답이 정상적으로 생성되었으면 반환
                        if (result.length > 0) {
                            return result;
                        } else {
                            console.warn('응답이 비어있습니다. 재시도합니다.');
                            throw new Error('EMPTY_RESPONSE');
                        }
                    } else {
                        console.error('응답 형식 오류:', response.data);
                        throw new Error('GEMINI API 응답 형식이 올바르지 않습니다.');
                    }
                } catch (err) {
                    lastError = err;
                    const isTimeout = err.code === 'ECONNABORTED' || /timeout/i.test(err.message);
                    const isEmptyResponse = err.message === 'EMPTY_RESPONSE';
                    const status = err.response?.status;
                    console.warn(`네이티브 호출 실패 (시도 ${attempt + 1}/${maxRetries + 1}) - status=${status || 'n/a'} timeout=${isTimeout} emptyResponse=${isEmptyResponse}`);
                    
                    // 빈 응답인 경우 더 긴 대기 시간
                    if (attempt < maxRetries) {
                        const backoffMs = isEmptyResponse ? 3000 * Math.pow(2, attempt) : 1000 * Math.pow(2, attempt);
                        console.log(`${backoffMs}ms 대기 후 재시도...`);
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
                top_p: requestBody.generationConfig.topP
                // max_tokens 제거 - 토큰 제한 없음
            };
            const oaResp = await axios.post(
                this.openAICompatUrl,
                oaBody,
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.apiKey}`
                        }
                        // 타임아웃 제거 - 무제한 대기
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

    // (중복 정의 제거됨)

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
            temperature: 0.65
            // 토큰 제한 제거 - 무제한 생성
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


### 💡 개인 맞춤 업무 전략

### ⏰ 시간 관리 혁신 방안


### 🎯 고객별 맞춤 전략 (실전 가이드)


### 🏠 매물별 마케팅 전략 (차별화 포인트)

### 🔄 혁신적 개선 제안사항


### 📈 성과 예측 및 목표 설정


각 조언은 구체적이고 실행 가능해야 하며, 사용자의 개인적 상황과 업무 환경을 고려한 맞춤형 내용이어야 합니다.
한국어로 전문적이고 실용적인 조언을 제공해주세요.
`;

        return await this.generateText(prompt, {
            temperature: 0.6
            // 토큰 제한 제거 - 무제한 생성
        });
    }

    /**
     * 주간 브리핑 생성
     * @param {Array} schedules - 일정 배열
     * @param {string} userName - 사용자 이름
     * @returns {Promise<string>} 생성된 브리핑
     */
    async generateWeeklyBriefing(schedules, userName) {
        // 시간순 정렬 정보와 핵심 컨텍스트를 제공 (형식에 덜 얽매이도록 지시)
        const ordered = [...schedules]
            .sort((a, b) => {
                const ad = new Date(a.date).getTime();
                const bd = new Date(b.date).getTime();
                const at = (a.time || '00:00');
                const bt = (b.time || '00:00');
                const att = parseInt(at.replace(':', ''), 10) || 0;
                const btt = parseInt(bt.replace(':', ''), 10) || 0;
                return ad !== bd ? ad - bd : att - btt;
            })
            .map(s => ({
                title: s.title,
                date: s.date,
                time: s.time,
                type: s.type,
                priority: s.priority,
                status: s.status,
                description: s.description,
                location: s.location,
                publisher: s.publisher?.name,
                customers: (s.relatedCustomers || []).map(c => ({ name: c.name })),
                properties: (s.relatedProperties || []).map(p => ({ title: p.title, address: p.address }))
            }));

        const prompt = `
당신은 부동산 CRM의 전략 코치입니다. ${userName}님의 이번 주 일정을 바탕으로 "언제, 어디서, 누구를" 만나는지 시간순으로 자연스럽게 정리하고, 형식에 얽매이지 말고 Gemini 스스로의 판단으로 가장 효과적인 접근 전략을 제안하세요. 지나치게 목차화하지 말고 흐름 있는 서술형 요약과 실전 조언을 섞어 주세요. (간결하게 하되 최대 길이: 1300자 이내 ) 

시간순 일정 요약 데이터(JSON):
${JSON.stringify(ordered, null, 2)}

요청 사항:
- 시간 흐름을 따라 핵심 일정과 만남의 맥락을 간결히 묘사
- 각 만남에서 유효한 첫 한마디, 질문 1-2개, 피해야 할 말 한 가지
- 고객/파트너 유형에 따른 주관적 판단 기반의 접근 전략(협상 톤, 자료 준비, 심리 포인트 등)
- 매물/계약이 얽힌 경우, 의사결정 트리거와 다음 액션 제시
- 마지막에 이번 주 리스크 3가지와완화책을 한줄 리스트로 정리

주의:
- 불필요한 형식화/표는 피하고, 자연스러운 문단 구성
- 과도한 일반론 대신, 데이터에 기반한 구체적 조언 중심
- 전체 분량은 1300자 이내를 지키기
`;

        return await this.generateText(prompt, {
            temperature: 0.8
            // 토큰 제한 제거 - 무제한 생성
        });
    }
}

module.exports = new GeminiService();
