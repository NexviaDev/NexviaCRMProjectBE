const Property = require('../models/Property.model');
const User = require('../models/user.model');
const mongoose = require('mongoose'); // Added missing import
const { logPropertyActivity } = require('../utils/activityLogger');

// 매물명 중복 검사
exports.checkTitleDuplicate = async (req, res) => {
    try {
        const { title } = req.query;
        const userId = req.user._id;

        if (!title || title.trim() === '') {
            return res.status(400).json({
                success: false,
                message: '매물명을 입력해주세요.'
            });
        }

        // 사용자 정보 가져오기
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: '사용자를 찾을 수 없습니다.'
            });
        }

        // 동일한 매물명이 있는지 확인
        const duplicateProperty = await Property.findOne({
            isDeleted: false,
            title: title.trim()
        }).populate('publisher', 'businessNumber');

        if (duplicateProperty) {
            // 같은 사업자번호인지 확인
            if (duplicateProperty.publisher.businessNumber === user.businessNumber) {
                return res.status(200).json({
                    success: true,
                    isDuplicate: true,
                    message: '이미 등록된 매물명입니다.',
                    existingProperty: {
                        id: duplicateProperty._id,
                        title: duplicateProperty.title,
                        type: duplicateProperty.type,
                        status: duplicateProperty.status,
                        publisher: duplicateProperty.publisher.nickname || duplicateProperty.publisher.name
                    }
                });
            } else {
                // 다른 회사의 매물명이므로 사용 가능
                return res.status(200).json({
                    success: true,
                    isDuplicate: false,
                    message: '사용 가능한 매물명입니다.'
                });
            }
        }

        // 중복되지 않는 경우
        res.status(200).json({
            success: true,
            isDuplicate: false,
            message: '사용 가능한 매물명입니다.'
        });

    } catch (error) {
        console.error('매물명 중복 검사 오류:', error);
        res.status(500).json({
            success: false,
            message: '매물명 중복 검사에 실패했습니다.'
        });
    }
};

// 매물 목록 조회
exports.getProperties = async (req, res) => {
    try {
        const { search, filterType } = req.query;
        const user = req.user; // 인증된 사용자 정보

        let query = {};
        
        // 사용자 권한에 따라 삭제된 매물 조회 여부 결정
        if (user && user.level >= 5) {
            // 레벨 5 이상: 삭제된 매물도 조회 가능
        } else {
            // 일반 사용자: 삭제되지 않은 매물만 조회
            query.isDeleted = false;
        }

        // 검색 필터
        if (search) {
            // 검색어를 공백으로 분리하여 배열로 만들기
            const searchTerms = search.trim().split(/\s+/).filter(term => term.length > 0);

            if (searchTerms.length > 0) {
                query.$or = [
                    { title: { $regex: search, $options: 'i' } },
                    { address: { $regex: search, $options: 'i' } }
                ];

                // 고객 정보로도 검색 가능하도록 추가
                const Customer = require('../models/Customer.model');

                if (searchTerms.length === 1) {
                    // 단일 검색어인 경우
                    const matchingCustomers = await Customer.find({
                        $or: [
                            { name: { $regex: searchTerms[0], $options: 'i' } },
                            { phone: { $regex: searchTerms[0], $options: 'i' } },
                            { email: { $regex: searchTerms[0], $options: 'i' } }
                        ]
                    }).select('_id');

                    if (matchingCustomers.length > 0) {
                        const customerIds = matchingCustomers.map(customer => customer._id);
                        query.$or.push({ customer: { $in: customerIds } });
                    }
                } else {
                    // 여러 검색어인 경우 - 모든 조건을 만족하는 고객만 찾기
                    const customerQueries = searchTerms.map(term => ({
                        $or: [
                            { name: { $regex: term, $options: 'i' } },
                            { phone: { $regex: term, $options: 'i' } },
                            { email: { $regex: term, $options: 'i' } }
                        ]
                    }));

                    // 모든 조건을 만족하는 고객 찾기
                    const matchingCustomers = await Customer.find({
                        $and: customerQueries
                    }).select('_id');

                    if (matchingCustomers.length > 0) {
                        const customerIds = matchingCustomers.map(customer => customer._id);
                        query.$or.push({ customer: { $in: customerIds } });
                    }
                }
            }
        }

        // 유형 필터
        if (filterType && filterType !== 'all') {
            query.type = filterType;
        }

        // 사용자 권한에 따른 필터링 (CustomerManagement와 동일한 로직)
        if (user) {
            if (user.level >= 11) {
                // 레벨 11 이상(전체 관리자): 모든 매물 조회 가능 (필터링 없음)
            } else if (user.businessNumber) {
                // 사업자번호가 있는 경우: 같은 사업자번호의 매물만 조회
                query.byCompanyNumber = user.businessNumber;
            } else {
                // 그 외: 자신이 등록한 매물만 조회
                query.publisher = user._id;
            }
        }


        
        // populate 대신 aggregation을 사용하여 사용자 정보 조회
        const propertiesWithUsers = await Property.aggregate([
            { $match: query },
            {
                $lookup: {
                    from: 'users', // MongoDB 컬렉션 이름 (소문자, 복수형)
                    localField: 'publisher',
                    foreignField: '_id',
                    as: 'publisherInfo'
                }
            },
            {
                $lookup: {
                    from: 'customers',
                    localField: 'customer',
                    foreignField: '_id',
                    as: 'customerInfo'
                }
            },
            {
                $addFields: {
                    publisher: { $arrayElemAt: ['$publisherInfo', 0] },
                    customer: { $arrayElemAt: ['$customerInfo', 0] }
                }
            },
            {
                $project: {
                    publisherInfo: 0,
                    customerInfo: 0
                }
            },
            { $sort: { createdAt: -1 } }
        ]);
        
        // aggregation 결과를 properties 변수에 할당
        properties = propertiesWithUsers;
        
        // aggregation 실패한 경우 수동으로 사용자 정보 조회
        for (let property of properties) {
            if (!property.publisher || !property.publisher._id) {
                try {
                    // 원본 publisher ObjectId 찾기
                    const rawProperty = await Property.findById(property._id).lean();
                    const publisherId = rawProperty.publisher;
                    
                    if (publisherId) {
                        const user = await User.findById(publisherId);
                        if (user) {
                            property.publisher = user;
                        } else {
                            // 빈 객체로 설정하여 에러 방지
                            property.publisher = {
                                _id: publisherId,
                                name: '삭제된 사용자',
                                nickname: '삭제됨',
                                email: '삭제됨',
                                businessNumber: '삭제됨'
                            };
                        }
                    }
                } catch (error) {
                    console.error(`사용자 정보 복구 중 오류:`, error);
                }
            }
        }
            
        // 사용자 권한에 따라 매물 필터링
        // 레벨 11 이상(전체 관리자)은 이미 백엔드 쿼리에서 모든 매물을 조회했으므로 추가 필터링 불필요
        if (user && user.level < 11) {
            properties = properties.filter((property) => {
                // 1. 내가 올린 매물 (publisher가 있는 경우만 체크)
                if (property.publisher && property.publisher._id && property.publisher._id.toString() === user._id.toString()) {
                    return true;
                }

                // 2. 같은 사업자번호이고 레벨이 3 이상 (byCompanyNumber로 체크 - publisher 삭제되어도 작동)
                if (
                    property.byCompanyNumber &&
                    property.byCompanyNumber === user.businessNumber &&
                    user.level >= 3
                ) {
                    return true;
                }

                // 3. 레벨이 5 이상이어도 같은 사업자번호의 매물만 접근
                if (user.level >= 5) {
                    // 같은 사업자번호의 매물은 자유롭게 접근 (byCompanyNumber로 체크)
                    if (property.byCompanyNumber === user.businessNumber) {
                        return true;
                    }
                    return false;
                }

                return false;
            });
        } else if (!user) {
            // 로그인하지 않은 경우 빈 배열 반환
            properties = [];
        }

        res.status(200).json({
            success: true,
            data: properties
        });
    } catch (error) {
        console.error('매물 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '매물 목록을 불러오는데 실패했습니다.'
        });
    }
};

// 매물 상세 조회
exports.getProperty = async (req, res) => {
    try {
        const { id } = req.params;

        const property = await Property.findOne({ _id: id, isDeleted: false })
            .populate('publisher', 'name nickname email contactNumber businessNumber level')
            .populate('customer', 'name phone email type')
            .populate('customerHistory.customer', 'name phone email type')
            .populate('customerHistory.changedBy', 'name nickname')
            .populate('modificationHistory.modifiedBy', 'name nickname')
            .populate('modificationHistory.changedBy', 'name nickname')
            .populate('modificationHistory.contractDetails.buyer', 'name phone email')
            .populate('modificationHistory.contractDetails.seller', 'name phone email')
            .populate('modificationHistory.contractDetails.agent', 'name nickname');

        if (!property) {
            return res.status(404).json({
                success: false,
                message: '매물을 찾을 수 없습니다.'
            });
        }

        res.status(200).json({
            success: true,
            data: property
        });
    } catch (error) {
        console.error('매물 상세 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '매물 정보를 불러오는데 실패했습니다.'
        });
    }
};

// 매물 등록
exports.createProperty = async (req, res) => {
    try {
        const { title, type, area, rooms, bathrooms, address, detailedAddress, status, customerId, specialNotes, parking, pets, elevator, contractPeriod, prices } = req.body;
        const publisherId = req.user._id; // JWT 토큰에서 사용자 ID 추출
        

        // 금액 필드를 숫자로 변환하는 함수
        const convertToNumber = (value) => {
            if (!value || value === '') return null;
            // 콤마 제거 후 숫자로 변환
            const cleanValue = value.toString().replace(/,/g, '');
            const numValue = parseFloat(cleanValue);
            return isNaN(numValue) ? null : numValue;
        };

        // 사용자 존재 확인
        const user = await User.findById(publisherId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: '사용자를 찾을 수 없습니다.'
            });
        }

        // 가격 정보 검증
        if (prices) {
            const validationErrors = [];
            
            // 매매가 선택된 경우 매매가격 필수
            if (type.includes('매매') && (!prices.매매가격 || prices.매매가격 === '')) {
                validationErrors.push('매매를 선택한 경우 매매가격을 입력해주세요.');
            }
            
            // 월세가 선택된 경우 월세가격 필수
            if (type.includes('월세') && (!prices.월세가격 || prices.월세가격 === '')) {
                validationErrors.push('월세를 선택한 경우 월세가격을 입력해주세요.');
            }
            
            // 전세가 선택된 경우 전세가격 필수
            if (type.includes('전세') && (!prices.전세가격 || prices.전세가격 === '')) {
                validationErrors.push('전세를 선택한 경우 전세가격을 입력해주세요.');
            }
            
            if (validationErrors.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: '가격 정보 입력 오류',
                    errors: validationErrors
                });
            }
        }

        // 중복 매물 체크 - 같은 사업자번호 내에서 매물명, 주소, 상세주소로 중복 검사
        const duplicateChecks = await Property.find({
            isDeleted: false,
            byCompanyNumber: user.businessNumber || '',
            $or: [
                { title: title }, // 같은 매물명
                { 
                    // 같은 주소와 상세주소
                    address: address,
                    detailedAddress: detailedAddress || ''
                }
            ]
        });

        if (duplicateChecks.length > 0) {
            const duplicateTitle = duplicateChecks.find(p => p.title === title);
            const duplicateAddress = duplicateChecks.find(p => 
                p.address === address && 
                (p.detailedAddress || '') === (detailedAddress || '')
            );

            if (duplicateTitle) {
                return res.status(400).json({
                    success: false,
                    message: '이미 등록된 매물명입니다. 다른 매물명을 사용해주세요.'
                });
            }

            if (duplicateAddress) {
                return res.status(400).json({
                    success: false,
                    message: '이미 등록된 주소와 상세주소의 매물입니다. 중복된 매물인지 확인해주세요.'
                });
            }
        }

        // prices 객체 처리
        const processedPrices = prices ? {
            매매가격: convertToNumber(prices.매매가격),
            월세가격: convertToNumber(prices.월세가격),
            월세보증금: convertToNumber(prices.월세보증금),
            전세가격: convertToNumber(prices.전세가격)
        } : {
            매매가격: null,
            월세가격: null,
            월세보증금: null,
            전세가격: null
        };

        const property = new Property({
            title,
            type,
            prices: processedPrices,
            area,
            rooms,
            bathrooms,
            address,
            detailedAddress: detailedAddress || '',
            status,
            parking: parking || '별도문의',
            pets: pets || '별도문의',
            elevator: elevator || '별도문의',
            specialNotes: specialNotes || '',
            contractPeriod: contractPeriod ? {
                startDate: contractPeriod.startDate && contractPeriod.startDate !== '' ? contractPeriod.startDate : null,
                endDate: contractPeriod.endDate && contractPeriod.endDate !== '' ? contractPeriod.endDate : null
            } : {
                startDate: null,
                endDate: null
            },
            publisher: publisherId,
            byCompanyNumber: user.businessNumber || '',
            customer: customerId || null
        });

        await property.save();

        // 등록된 매물 정보 반환 (게시자 정보 포함)
        const savedProperty = await Property.findById(property._id)
            .populate('publisher', 'name nickname email businessNumber level');

        // 활동기록 로깅
        await logPropertyActivity(
            '매물 등록',
            `${title} 매물이 등록되었습니다.`,
            publisherId,
            user.name || user.email,
            property._id,
            title,
            {
                type,
                prices: processedPrices,
                area,
                address,
                status
            },
            req
        );

        res.status(201).json({
            success: true,
            message: '매물이 성공적으로 등록되었습니다.',
            data: savedProperty
        });
    } catch (error) {
        console.error('매물 등록 오류:', error);
        console.error('오류 스택:', error.stack);
        res.status(500).json({
            success: false,
            message: '매물 등록에 실패했습니다.',
            error: error.message
        });
    }
};

// 매물 수정
exports.updateProperty = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, type, area, rooms, bathrooms, address, detailedAddress, status, specialNotes, parking, pets, elevator, contractPeriod, prices } = req.body;
        const userId = req.user._id;

        // 금액 필드를 숫자로 변환하는 함수
        const convertToNumber = (value) => {
            if (!value || value === '') return null;
            // 콤마 제거 후 숫자로 변환
            const cleanValue = value.toString().replace(/,/g, '');
            const numValue = parseFloat(cleanValue);
            return isNaN(numValue) ? null : numValue;
        };

        // 매물 존재 확인
        const originalProperty = await Property.findById(id);
        if (!originalProperty || originalProperty.isDeleted) {
            return res.status(404).json({
                success: false,
                message: '매물을 찾을 수 없습니다.'
            });
        }

        // 가격 정보 검증
        if (prices) {
            const validationErrors = [];
            
            // 매매가 선택된 경우 매매가격 필수
            if (type.includes('매매') && (!prices.매매가격 || prices.매매가격 === '')) {
                validationErrors.push('매매를 선택한 경우 매매가격을 입력해주세요.');
            }
            
            // 월세가 선택된 경우 월세가격 필수
            if (type.includes('월세') && (!prices.월세가격 || prices.월세가격 === '')) {
                validationErrors.push('월세를 선택한 경우 월세가격을 입력해주세요.');
            }
            
            // 전세가 선택된 경우 전세가격 필수
            if (type.includes('전세') && (!prices.전세가격 || prices.전세가격 === '')) {
                validationErrors.push('전세를 선택한 경우 전세가격을 입력해주세요.');
            }
            
            if (validationErrors.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: '가격 정보 입력 오류',
                    errors: validationErrors
                });
            }
        }

        // 권한 확인 - byCompanyNumber 기반으로 변경
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: '사용자를 찾을 수 없습니다.'
            });
        }

        if (user.level < 5) {
            // Level 5 미만은 자신이 등록한 매물만 수정
            if (originalProperty.publisher.toString() !== userId.toString()) {
                return res.status(403).json({
                    success: false,
                    message: '매물을 수정할 권한이 없습니다.'
                });
            }
        } else {
            // Level 5 이상은 같은 사업자 번호의 매물만 수정
            if (originalProperty.byCompanyNumber !== user.businessNumber) {
                return res.status(403).json({
                    success: false,
                    message: '매물을 수정할 권한이 없습니다.'
                });
            }
        }

        // 매물명 중복 검사 (자신의 매물 제외)
        if (title !== originalProperty.title) {
            const duplicateCheck = await Property.findOne({
                _id: { $ne: id }, // 현재 수정 중인 매물 제외
                isDeleted: false,
                title: title
            }).populate('publisher', 'businessNumber');

            if (duplicateCheck) {
                // 같은 사업자번호인지 확인
                if (duplicateCheck.publisher.businessNumber === req.user.businessNumber) {
                    return res.status(400).json({
                        success: false,
                        message: '이미 등록된 매물명입니다. 다른 매물명을 사용해주세요.'
                    });
                }
            }
        }

        // 변경 사항 감지 및 히스토리 기록
        const modificationHistory = [];

        // 각 필드별 변경 사항 확인
        if (originalProperty.title !== title) {
            modificationHistory.push({
                field: '매물명',
                oldValue: originalProperty.title,
                newValue: title,
                changeDate: new Date(),
                changedBy: userId
            });
        }

        if (originalProperty.type !== type) {
            modificationHistory.push({
                field: '매물 유형',
                oldValue: Array.isArray(originalProperty.type) ? originalProperty.type.join(', ') : originalProperty.type,
                newValue: Array.isArray(type) ? type.join(', ') : type,
                changeDate: new Date(),
                changedBy: userId
            });
        }


        if (originalProperty.area !== area) {
            modificationHistory.push({
                field: '면적',
                oldValue: originalProperty.area,
                newValue: area,
                changeDate: new Date(),
                changedBy: userId
            });
        }

        if (originalProperty.rooms !== parseInt(rooms)) {
            modificationHistory.push({
                field: '방 개수',
                oldValue: originalProperty.rooms.toString(),
                newValue: rooms.toString(),
                changeDate: new Date(),
                changedBy: userId
            });
        }

        if (originalProperty.bathrooms !== parseInt(bathrooms)) {
            modificationHistory.push({
                field: '욕실 개수',
                oldValue: originalProperty.bathrooms.toString(),
                newValue: bathrooms.toString(),
                changeDate: new Date(),
                changedBy: userId
            });
        }

        if (originalProperty.status !== status) {
            modificationHistory.push({
                field: '상태',
                oldValue: originalProperty.status,
                newValue: status,
                changeDate: new Date(),
                changedBy: userId
            });
        }

        if (originalProperty.parking !== parking) {
            modificationHistory.push({
                field: '주차',
                oldValue: originalProperty.parking,
                newValue: parking,
                changeDate: new Date(),
                changedBy: userId
            });
        }

        if (originalProperty.pets !== pets) {
            modificationHistory.push({
                field: '애완동물',
                oldValue: originalProperty.pets,
                newValue: pets,
                changeDate: new Date(),
                changedBy: userId
            });
        }

        if (originalProperty.elevator !== elevator) {
            modificationHistory.push({
                field: '엘리베이터',
                oldValue: originalProperty.elevator,
                newValue: elevator,
                changeDate: new Date(),
                changedBy: userId
            });
        }

        if (originalProperty.specialNotes !== specialNotes) {
            modificationHistory.push({
                field: '특이사항',
                oldValue: originalProperty.specialNotes || '',
                newValue: specialNotes || '',
                changeDate: new Date(),
                changedBy: userId
            });
        }

        // prices 필드 변경 사항 확인
        if (prices) {
            const processedPrices = {
                매매가격: convertToNumber(prices.매매가격),
                월세가격: convertToNumber(prices.월세가격),
                월세보증금: convertToNumber(prices.월세보증금),
                전세가격: convertToNumber(prices.전세가격)
            };

            // 각 가격 필드별 변경 사항 확인
            if (originalProperty.prices?.매매가격 !== processedPrices.매매가격) {
                modificationHistory.push({
                    field: '매매가격',
                    oldValue: originalProperty.prices?.매매가격?.toString() || '0',
                    newValue: processedPrices.매매가격?.toString() || '0',
                    changeDate: new Date(),
                    changedBy: userId
                });
            }

            if (originalProperty.prices?.월세가격 !== processedPrices.월세가격) {
                modificationHistory.push({
                    field: '월세가격',
                    oldValue: originalProperty.prices?.월세가격?.toString() || '0',
                    newValue: processedPrices.월세가격?.toString() || '0',
                    changeDate: new Date(),
                    changedBy: userId
                });
            }

            if (originalProperty.prices?.월세보증금 !== processedPrices.월세보증금) {
                modificationHistory.push({
                    field: '월세보증금',
                    oldValue: originalProperty.prices?.월세보증금?.toString() || '0',
                    newValue: processedPrices.월세보증금?.toString() || '0',
                    changeDate: new Date(),
                    changedBy: userId
                });
            }

            if (originalProperty.prices?.전세가격 !== processedPrices.전세가격) {
                modificationHistory.push({
                    field: '전세가격',
                    oldValue: originalProperty.prices?.전세가격?.toString() || '0',
                    newValue: processedPrices.전세가격?.toString() || '0',
                    changeDate: new Date(),
                    changedBy: userId
                });
            }
        }

        if (originalProperty.detailedAddress !== detailedAddress) {
            modificationHistory.push({
                field: '상세주소',
                oldValue: originalProperty.detailedAddress || '',
                newValue: detailedAddress || '',
                changeDate: new Date(),
                changedBy: userId
            });
        }

        // prices 객체 처리
        const processedPrices = prices ? {
            매매가격: convertToNumber(prices.매매가격),
            월세가격: convertToNumber(prices.월세가격),
            월세보증금: convertToNumber(prices.월세보증금),
            전세가격: convertToNumber(prices.전세가격)
        } : {
            매매가격: null,
            월세가격: null,
            월세보증금: null,
            전세가격: null
        };

        // 매물 정보 업데이트 (히스토리 포함)
        const updateData = {
            title,
            type,
            prices: processedPrices,
            area,
            rooms,
            bathrooms,
            address,
            detailedAddress: detailedAddress || '',
            status,
            parking: parking || '별도문의',
            pets: pets || '별도문의',
            elevator: elevator || '별도문의',
            specialNotes: specialNotes || '',
            byCompanyNumber: user.businessNumber || ''
        };

        // 계약 기간이 제공된 경우 추가, 없으면 기본값 설정
        if (contractPeriod) {
            // 날짜를 문자열로 저장 (시간대 문제 해결)
            updateData.contractPeriod = {
                startDate: contractPeriod.startDate && contractPeriod.startDate !== '' ? contractPeriod.startDate : null,
                endDate: contractPeriod.endDate && contractPeriod.endDate !== '' ? contractPeriod.endDate : null
            };
        } else {
            // 기존 데이터에 contractPeriod가 없을 경우 기본값 설정
            updateData.contractPeriod = {
                startDate: null,
                endDate: null
            };
        }

        // 변경 사항이 있으면 히스토리에 추가
        if (modificationHistory.length > 0) {
            updateData.$push = {
                modificationHistory: { $each: modificationHistory }
            };
        }

        const updatedProperty = await Property.findByIdAndUpdate(
            id,
            updateData,
            { new: true }
        ).populate('publisher', 'nickname email businessNumber level')
            .populate('modificationHistory.modifiedBy', 'name nickname')
            .populate('modificationHistory.changedBy', 'name nickname')
            .populate('modificationHistory.contractDetails.buyer', 'name phone email')
            .populate('modificationHistory.contractDetails.seller', 'name phone email')
            .populate('modificationHistory.contractDetails.agent', 'name nickname');

        // 변경 사항 비교 함수
        const getChangedFields = (original, updated) => {
            const changes = {};
            const fieldsToCompare = [
                'title', 'type', 'prices', 'area', 'rooms', 'bathrooms', 
                'address', 'detailedAddress', 'status', 'specialNotes', 'parking', 
                'pets', 'elevator', 'contractPeriod'
            ];
            
            fieldsToCompare.forEach(field => {
                if (field === 'contractPeriod') {
                    // contractPeriod는 객체이므로 특별 처리
                    const originalPeriod = original[field] || {};
                    const updatedPeriod = updated[field] || {};
                    if (JSON.stringify(originalPeriod) !== JSON.stringify(updatedPeriod)) {
                        changes[field] = {
                            from: originalPeriod,
                            to: updatedPeriod
                        };
                    }
                } else if (field === 'type') {
                    // type은 배열이므로 특별 처리
                    const originalType = original[field] || [];
                    const updatedType = updated[field] || [];
                    if (JSON.stringify(originalType) !== JSON.stringify(updatedType)) {
                        changes[field] = {
                            from: originalType,
                            to: updatedType
                        };
                    }
                } else if (field === 'prices') {
                    // prices는 객체이므로 특별 처리
                    const originalPrices = original[field] || {};
                    const updatedPrices = updated[field] || {};
                    if (JSON.stringify(originalPrices) !== JSON.stringify(updatedPrices)) {
                        changes[field] = {
                            from: originalPrices,
                            to: updatedPrices
                        };
                    }
                } else {
                    const originalValue = original[field];
                    const updatedValue = updated[field];
                    
                    // null과 undefined를 동일하게 처리
                    const normalizedOriginal = originalValue === null ? undefined : originalValue;
                    const normalizedUpdated = updatedValue === null ? undefined : updatedValue;
                    
                    if (normalizedOriginal !== normalizedUpdated) {
                        changes[field] = {
                            from: originalValue,
                            to: updatedValue
                        };
                    }
                }
            });
            
            return changes;
        };

        // 변경 사항 추출 (Mongoose 문서를 일반 객체로 변환)
        let changes = {};
        try {
            const originalData = originalProperty.toObject();
            changes = getChangedFields(originalData, updatedProperty);
        } catch (changeError) {
            console.error('변경 사항 추출 오류:', changeError);
            // 변경 사항 추출에 실패해도 매물 수정은 계속 진행
            changes = {};
        }

        // 활동기록 로깅
        await logPropertyActivity(
            '매물 수정',
            `${updatedProperty.title} 매물이 수정되었습니다.`,
            userId,
            req.user.name || req.user.email,
            updatedProperty._id,
            updatedProperty.title,
            {
                updatedFields: Object.keys(updateData),
                changes: changes,
                changeCount: Object.keys(changes).length,
                type: updatedProperty.type,
                prices: updatedProperty.prices,
                area: updatedProperty.area,
                address: updatedProperty.address,
                status: updatedProperty.status
            },
            req
        );

        res.status(200).json({
            success: true,
            message: '매물이 성공적으로 수정되었습니다.',
            data: updatedProperty
        });
    } catch (error) {
        console.error('매물 수정 오류:', error);
        console.error('오류 스택:', error.stack);
        res.status(500).json({
            success: false,
            message: '매물 수정에 실패했습니다.',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// 매물 삭제 (완전 삭제)
exports.deleteProperty = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;

        // 매물 존재 확인 (publisher 정보 포함)
        const property = await Property.findById(id).populate('publisher', 'businessNumber');
        if (!property) {
            return res.status(404).json({
                success: false,
                message: '매물을 찾을 수 없습니다.'
            });
        }

        // 권한 확인 - byCompanyNumber 기반으로 변경
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: '사용자를 찾을 수 없습니다.'
            });
        }

        let hasPermission = false;
        
        if (user.level < 5) {
            // Level 5 미만은 자신이 등록한 매물만 삭제
            if (property.publisher && property.publisher.toString() === userId.toString()) {
                hasPermission = true;
            }
        } else {
            // Level 5 이상은 같은 사업자 번호의 매물만 삭제
            if (property.byCompanyNumber === user.businessNumber) {
                hasPermission = true;
            }
        }
        
        // 레벨 11 이상은 모든 매물 삭제 가능
        if (user.level >= 11) {
            hasPermission = true;
        }

        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                message: '매물을 삭제할 권한이 없습니다.'
            });
        }

        // 고객에서 해당 매물 제거
        if (property.customer) {
            const Customer = require('../models/Customer.model');
            await Customer.findByIdAndUpdate(property.customer, {
                $pull: { 
                    properties: { property: id },
                    propertyHistory: { property: id }
                }
            });
        }

        // 활동기록 로깅 (삭제 전에 로깅)
        await logPropertyActivity(
            '매물 삭제',
            `${property.title} 매물이 삭제되었습니다.`,
            userId,
            req.user.name || req.user.email,
            property._id,
            property.title,
            {
                type: property.type,
                price: property.price,
                deposit: property.deposit,
                area: property.area,
                address: property.address,
                status: property.status,
                reason: '사용자 요청에 의한 삭제'
            },
            req
        );

        // 매물 완전 삭제
        await Property.findByIdAndDelete(id);

        res.status(200).json({
            success: true,
            message: '매물이 성공적으로 삭제되었습니다.'
        });
    } catch (error) {
        console.error('매물 삭제 오류:', error);
        res.status(500).json({
            success: false,
            message: '매물 삭제에 실패했습니다.'
        });
    }
};

// 내가 등록한 매물 목록 조회
exports.getMyProperties = async (req, res) => {
    try {
        const userId = req.user._id;

        const properties = await Property.find({
            publisher: userId,
            isDeleted: false
        })
            .populate('publisher', 'nickname email businessNumber level')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            data: properties
        });
    } catch (error) {
        console.error('내 매물 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '내 매물 목록을 불러오는데 실패했습니다.'
        });
    }
};

// 매물 소유자 변경
exports.changePropertyOwner = async (req, res) => {
    try {
        const { id } = req.params;
        const { newOwnerId, customerName, customerPhone, oldCustomerName, oldCustomerPhone } = req.body;
        const userId = req.user._id;

        // 매물 존재 확인
        const property = await Property.findById(id);
        if (!property || property.isDeleted) {
            return res.status(404).json({
                success: false,
                message: '매물을 찾을 수 없습니다.'
            });
        }

        // newOwnerId가 null이면 소유권 해제, 아니면 유효한 ObjectId인지 확인
        if (newOwnerId !== null && (newOwnerId === 'temp' || !mongoose.Types.ObjectId.isValid(newOwnerId))) {
            return res.status(400).json({
                success: false,
                message: '유효하지 않은 고객 ID입니다.'
            });
        }

        // 기존 고객 정보 저장
        const oldCustomer = property.customer;

        // 고객 변경 히스토리에 기록
        const customerHistoryEntry = {
            customer: newOwnerId,
            customerName: customerName || '알 수 없음',
            customerPhone: customerPhone || '',
            changeDate: new Date(),
            changeType: newOwnerId ? '소유자 변경' : '소유권 해제',
            changedBy: userId
        };

        // 기존 고객이 있었다면 처리
        if (oldCustomer && oldCustomer.toString() !== newOwnerId.toString()) {
            // 기존 고객의 properties 배열에서 해당 매물 제거 및 히스토리 기록
            const Customer = require('../models/Customer.model');
            await Customer.findByIdAndUpdate(oldCustomer, {
                $pull: { properties: { property: id } },
                $push: {
                    propertyHistory: {
                        property: id,
                        propertyTitle: property.title,
                        changeDate: new Date(),
                        changeType: '소유권 이전',
                        changedBy: userId,
                        previousOwner: oldCustomer,
                        newOwner: newOwnerId
                    }
                }
            });
            
            // 기존 고객 히스토리에 해제 기록 추가
            const oldCustomerHistoryEntry = {
                customer: oldCustomer,
                customerName: oldCustomerName || '알 수 없음',
                customerPhone: oldCustomerPhone || '',
                changeDate: new Date(),
                changeType: '소유자 해제',
                changedBy: userId
            };
            property.customerHistory.push(oldCustomerHistoryEntry);
        }

        // 새로운 고객 연결 (null이면 소유권 해제)
        property.customer = newOwnerId;
        property.customerHistory.push(customerHistoryEntry);

        // 기존 modificationHistory에서 불완전한 항목들 제거 (필수 필드가 없는 항목들)
        property.modificationHistory = property.modificationHistory.filter(history => 
            history.modificationType && history.modifiedBy
        );

        // modificationHistory에 소유자 변경 기록 추가
        property.modificationHistory.push({
            modifiedBy: userId,
            modifiedAt: new Date(),
            modificationType: '소유자변경',
            previousStatus: oldCustomer ? '소유자 있음' : '소유자 없음',
            newStatus: newOwnerId ? '소유자 있음' : '소유자 없음',
            contractDetails: {
                previousOwner: oldCustomer,
                newOwner: newOwnerId,
                changeReason: '고객 등록/수정을 통한 소유자 변경'
            }
        });

        await property.save();

        // 새로운 고객이 있는 경우에만 properties 배열에 매물 추가 (중복 방지)
        if (newOwnerId) {
            const Customer = require('../models/Customer.model');
            // 먼저 기존 매물 제거 (중복 방지)
            await Customer.findByIdAndUpdate(newOwnerId, {
                $pull: { properties: { property: id } }
            });
            
            // 그 후 새로 추가
            await Customer.findByIdAndUpdate(newOwnerId, {
                $push: {
                    properties: {
                        property: id,
                        addedAt: new Date()
                    },
                    propertyHistory: {
                        property: id,
                        propertyTitle: property.title,
                        changeDate: new Date(),
                        changeType: '추가',
                        changedBy: userId,
                        newOwner: newOwnerId
                    }
                }
            });
        }

        // 변경된 매물 정보 반환
        const updatedProperty = await Property.findById(id)
            .populate('publisher', 'name nickname email')
            .populate('customer', 'name phone email type')
            .populate('customerHistory.customer', 'name phone email type')
            .populate('customerHistory.changedBy', 'name nickname');

        res.status(200).json({
            success: true,
            message: '매물 소유자가 성공적으로 변경되었습니다.',
            data: updatedProperty
        });
    } catch (error) {
        console.error('매물 소유자 변경 오류:', error);
        res.status(500).json({
            success: false,
            message: '매물 소유자 변경에 실패했습니다.'
        });
    }
}; 

// 매물 publisher 업데이트 (관리자용)
exports.updatePropertyPublishers = async (req, res) => {
    try {
        const userId = req.user._id;
        
        // 레벨 11 이상만 접근 가능
        if (req.user.level < 11) {
            return res.status(403).json({
                success: false,
                message: '권한이 부족합니다.'
            });
        }
        
        // publisher가 null이거나 존재하지 않는 User를 참조하는 매물들 찾기
        const properties = await Property.find({
            isDeleted: false,
            $or: [
                { publisher: null },
                { publisher: { $exists: false } }
            ]
        });
        
        // 각 매물의 publisher를 현재 사용자로 업데이트
        for (const property of properties) {
            await Property.findByIdAndUpdate(property._id, {
                publisher: userId
            });
        }
        
        // 존재하지 않는 User를 참조하는 매물들도 업데이트
        const existingUserIds = await User.find({}).select('_id');
        const existingUserIdStrings = existingUserIds.map(u => u._id.toString());
        
        const propertiesWithInvalidPublisher = await Property.find({
            isDeleted: false,
            publisher: { $nin: existingUserIdStrings }
        });
        
        for (const property of propertiesWithInvalidPublisher) {
            await Property.findByIdAndUpdate(property._id, {
                publisher: userId
            });
        }
        
        res.status(200).json({
            success: true,
            message: '매물 publisher 업데이트가 완료되었습니다.',
            updatedCount: properties.length + propertiesWithInvalidPublisher.length
        });
        
    } catch (error) {
        console.error('매물 publisher 업데이트 오류:', error);
        res.status(500).json({
            success: false,
            message: '매물 publisher 업데이트에 실패했습니다.'
        });
    }
}; 