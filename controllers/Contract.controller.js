const Contract = require('../models/Contract.model');
const Customer = require('../models/Customer.model');
const User = require('../models/user.model');
const Property = require('../models/Property.model');
const Schedule = require('../models/Schedule.model'); // Schedule 모델 추가
const { logContractActivity } = require('../utils/activityLogger');

// 계약 목록 조회
const getContracts = async (req, res) => {
    try {
        const { search, status, type, page, limit } = req.query;
        const user = req.user;

        let query = {};

        // 검색 조건 - MongoDB aggregation을 사용하여 populate된 필드에서도 검색
        if (search) {
            // 먼저 기본 필드에서 검색
            const basicSearchQuery = {
                $or: [
                    { contractNumber: { $regex: search, $options: 'i' } }
                ]
            };
            
            // populate된 필드에서 검색하기 위해 aggregation 사용
            const searchPipeline = [
                {
                    $lookup: {
                        from: 'customers',
                        localField: 'buyer',
                        foreignField: '_id',
                        as: 'buyerInfo'
                    }
                },
                {
                    $lookup: {
                        from: 'customers',
                        localField: 'seller',
                        foreignField: '_id',
                        as: 'sellerInfo'
                    }
                },
                {
                    $lookup: {
                        from: 'properties',
                        localField: 'property',
                        foreignField: '_id',
                        as: 'propertyInfo'
                    }
                },
                {
                    $match: {
                        $or: [
                            { contractNumber: { $regex: search, $options: 'i' } },
                            { 'buyerInfo.name': { $regex: search, $options: 'i' } },
                            { 'sellerInfo.name': { $regex: search, $options: 'i' } },
                            { 'propertyInfo.title': { $regex: search, $options: 'i' } },
                            { 'propertyInfo.address': { $regex: search, $options: 'i' } }
                        ]
                    }
                },
                {
                    $project: {
                        _id: 1
                    }
                }
            ];
            
            // 검색 결과의 ID들을 가져와서 query에 추가
            const searchResults = await Contract.aggregate(searchPipeline);
            const searchIds = searchResults.map(result => result._id);
            
            if (searchIds.length > 0) {
                query._id = { $in: searchIds };
            } else {
                // 검색 결과가 없으면 빈 결과 반환
                query._id = null;
            }
        }

        // 상태 필터
        if (status && status !== 'all') {
            query.status = status;
        }

        // 타입 필터
        if (type && type !== 'all') {
            query.type = type;
        }

        // 권한에 따른 필터링 - byCompanyNumber 기반으로 변경
        if (user.level < 5) {
            // Level 5 미만은 자신이 등록한 계약만 조회
            query.publisher = user._id;
        } else {
            // Level 5 이상은 같은 사업자 번호의 계약만 조회
            query.byCompanyNumber = user.businessNumber;
        }

        // 페이지네이션 파라미터 처리
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 30;
        const skip = (pageNum - 1) * limitNum;

        // 총 아이템 수 조회
        const totalItems = await Contract.countDocuments(query);

        const contracts = await Contract.find(query)
            .populate('buyer', 'name phone email type')
            .populate('seller', 'name phone email type')
            .populate('publisher', 'name email businessNumber')
            .populate('agent', 'name email phone businessNumber')
            .populate('property', 'title address type status')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum);



        res.json({
            success: true,
            data: contracts,
            total: totalItems,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(totalItems / limitNum)
        });
    } catch (error) {
        console.error('계약 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '계약 목록을 불러오는 중 오류가 발생했습니다.'
        });
    }
};

// 계약 상세 조회
const getContractById = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;

        const contract = await Contract.findById(id)
            .populate('buyer', 'name phone email type')
            .populate('seller', 'name phone email type')
            .populate('publisher', 'name email')
            .populate('agent', 'name email phone businessNumber')
            .populate('property', 'title address type status');

        if (!contract) {
            return res.status(404).json({
                success: false,
                message: '계약을 찾을 수 없습니다.'
            });
        }

        // 권한 확인 - byCompanyNumber 기반으로 변경
        if (user.level < 5) {
            // Level 5 미만은 자신이 등록한 계약만 조회
            if (contract.publisher._id.toString() !== user._id.toString()) {
                return res.status(403).json({
                    success: false,
                    message: '해당 계약에 대한 접근 권한이 없습니다.'
                });
            }
        } else {
            // Level 5 이상은 같은 사업자 번호의 계약만 조회
            if (contract.byCompanyNumber !== user.businessNumber) {
                return res.status(403).json({
                    success: false,
                    message: '해당 계약에 대한 접근 권한이 없습니다.'
                });
            }
        }

        res.json({
            success: true,
            data: contract
        });
    } catch (error) {
        console.error('계약 상세 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '계약 정보를 불러오는 중 오류가 발생했습니다.'
        });
    }
};

// 계약 등록
const createContract = async (req, res) => {
    try {
        const user = req.user;
        const contractData = req.body;

        // 필수 필드 검증
        if (!contractData.property || !contractData.type || !contractData.agent || !contractData.contractDate) {
            return res.status(400).json({
                success: false,
                message: '필수 필드가 누락되었습니다. (매물, 계약유형, 담당자, 계약일)'
            });
        }

        // 담당자(agent) 검증
        const agent = await User.findById(contractData.agent);
        if (!agent) {
            return res.status(400).json({
                success: false,
                message: '선택한 담당자를 찾을 수 없습니다.'
            });
        }

        // 매수자 정보 처리 (Customer ID만 사용)
        if (!contractData.buyer) {
            return res.status(400).json({
                success: false,
                message: '매수자 정보가 필요합니다.'
            });
        }

        const buyerCustomer = await Customer.findById(contractData.buyer);
        if (!buyerCustomer) {
            return res.status(400).json({
                success: false,
                message: '선택한 매수자 고객을 찾을 수 없습니다.'
            });
        }

        // 매도자 정보 처리 (Customer ID만 사용)
        if (!contractData.seller) {
            return res.status(400).json({
                success: false,
                message: '매도자 정보가 필요합니다.'
            });
        }

        const sellerCustomer = await Customer.findById(contractData.seller);
        if (!sellerCustomer) {
            return res.status(400).json({
                success: false,
                message: '선택한 매도자 고객을 찾을 수 없습니다.'
            });
        }

        // 날짜 필드 처리
        const processedData = {
            ...contractData,
            publisher: user._id,
            byCompanyNumber: user.businessNumber || ''
        };

        // 금액 필드를 숫자로 변환하는 함수
        const convertToNumber = (value) => {
            if (!value || value === '') return null;
            // 콤마 제거 후 숫자로 변환
            const cleanValue = value.toString().replace(/,/g, '');
            const numValue = parseFloat(cleanValue);
            return isNaN(numValue) ? null : numValue;
        };

        // 금액 필드들을 숫자로 변환
        processedData.price = convertToNumber(processedData.price);
        processedData.commission = convertToNumber(processedData.commission);
        processedData.deposit = convertToNumber(processedData.deposit);

        // 날짜 필드들을 Date 객체로 변환
        if (processedData.contractDate) {
            processedData.contractDate = new Date(processedData.contractDate);
        }
        if (processedData.closingDate) {
            processedData.closingDate = new Date(processedData.closingDate);
        }
        if (processedData.startDate) {
            processedData.startDate = new Date(processedData.startDate);
        }
        if (processedData.endDate) {
            processedData.endDate = new Date(processedData.endDate);
        }

        // 계약 유형별 필드 검증
        if (processedData.type === '매매') {
            if (!processedData.price) {
                return res.status(400).json({
                    success: false,
                    message: '매매 계약의 경우 매매가격은 필수입니다.'
                });
            }
        } else if (processedData.type === '월세') {
            if (!processedData.price || !processedData.deposit) {
                return res.status(400).json({
                    success: false,
                    message: '월세 계약의 경우 월세와 보증금은 필수입니다.'
                });
            }
        } else if (processedData.type === '전세') {
            if (!processedData.price) {
                return res.status(400).json({
                    success: false,
                    message: '전세 계약의 경우 전세가격은 필수입니다.'
                });
            }
        }

        // 계약 저장
        const newContract = new Contract(processedData);
        await newContract.save();

        // 계약 저장 후 contractNumber가 생성된 상태로 다시 조회
        const savedContract = await Contract.findById(newContract._id);
        
        // 계약 등록 시 자동으로 일정 생성 (통합된 함수 사용)
        await createContractSchedule(savedContract, user);

        // 매물 상태 업데이트 (계약번호가 생성된 후에 실행)
        if (processedData.property) {
            const property = await Property.findById(processedData.property);
            if (property) {
                let newStatus = '';
                
                // 계약 유형에 따른 매물 상태 설정
                if (processedData.type === '매매') {
                    newStatus = processedData.status === '완료' ? '판매완료' : '판매중';
                } else if (processedData.type === '월세') {
                    newStatus = processedData.status === '완료' ? '월세완료' : '월세중';
                } else if (processedData.type === '전세') {
                    newStatus = processedData.status === '완료' ? '전세완료' : '전세중';
                } else {
                    // 기타 유형의 경우
                    newStatus = processedData.status === '완료' ? '계약완료' : '계약중';
                }
                
                // 매물 상태 업데이트
                property.status = newStatus;
                
                // 매물 수정 히스토리에 계약 정보 추가 (계약번호가 생성된 후)
                const modificationEntry = {
                    modifiedBy: user._id,
                    modifiedAt: new Date(),
                    modificationType: '계약등록',
                    previousStatus: property.status,
                    newStatus: newStatus,
                    contractDetails: {
                        contractNumber: newContract.contractNumber, // 생성된 계약번호 사용
                        contractType: processedData.type,
                        contractStatus: processedData.status,
                        price: processedData.price,
                        deposit: processedData.deposit,
                        commission: processedData.commission,
                        contractDate: processedData.contractDate,
                        closingDate: processedData.closingDate,
                        startDate: processedData.startDate,
                        endDate: processedData.endDate,
                        buyer: processedData.buyer,
                        seller: processedData.seller,
                        agent: processedData.agent
                    },
                    description: `계약번호: ${newContract.contractNumber}, 유형: ${processedData.type}, 상태: ${processedData.status}${processedData.startDate && processedData.endDate ? `, 기간: ${new Date(processedData.startDate).toLocaleDateString('ko-KR')} ~ ${new Date(processedData.endDate).toLocaleDateString('ko-KR')}` : ''}`
                };
                
                property.modificationHistory.push(modificationEntry);
                await property.save();
                
            }
        }

        // 매물 소유권 이전 처리 - 매매 계약이고 완료 상태일 때만 실행
        if (processedData.property && processedData.status === '완료' && processedData.type === '매매') {
            const property = await Property.findById(processedData.property);
            if (property) {
                // 매도자의 properties 배열에서 해당 매물 제거
                await Customer.findByIdAndUpdate(processedData.seller, {
                    $pull: { 
                        properties: { property: processedData.property },
                        propertyHistory: { property: processedData.property }
                    }
                });

                // 매수자의 properties 배열에 매물 추가
                const buyerCustomer = await Customer.findById(processedData.buyer);
                if (buyerCustomer) {
                    await Customer.findByIdAndUpdate(processedData.buyer, {
                        $push: {
                            properties: {
                                property: processedData.property,
                                askingPrice: null,
                                monthlyRent: null,
                                deposit: null,
                                jeonseDeposit: null,
                                addedAt: new Date()
                            },
                            propertyHistory: {
                                property: processedData.property,
                                propertyTitle: property.title,
                                changeDate: new Date(),
                                changeType: '추가',
                                changedBy: user._id,
                                newOwner: processedData.buyer
                            }
                        }
                    });
                }

                // 매물의 customer 필드 업데이트
                property.customer = processedData.buyer;
                property.customerHistory.push({
                    customer: processedData.buyer,
                    customerName: buyerCustomer.name,
                    customerPhone: buyerCustomer.phone,
                    changeDate: new Date(),
                    changeType: '소유자 변경',
                    changedBy: user._id,
                    previousOwner: processedData.seller,
                    newOwner: processedData.buyer
                });

                // 계약이 완료 상태인 경우 매물 상태도 변경
                property.status = '판매완료';

                await property.save();
            } else {
                console.error('매물을 찾을 수 없습니다:', processedData.property);
            }
        } else if (processedData.property && processedData.status !== '완료') {
            // 계약이 완료되지 않은 상태에서 매물이 지정된 경우 로그만 기록
        }

        const populatedContract = await Contract.findById(savedContract._id)
            .populate('buyer', 'name phone email')
            .populate('seller', 'name phone email')
            .populate('publisher', 'name')
            .populate('agent', 'name email phone');

        // 활동기록 로깅 (populate된 정보 사용)
        await logContractActivity(
            '계약 생성',
            `${contractData.type} 계약이 생성되었습니다.`,
            user._id,
            user.name || user.email,
            savedContract._id,
            contractData.type,
            {
                type: contractData.type,
                status: populatedContract.status || '진행중',
                contractNumber: populatedContract.contractNumber,
                propertyId: contractData.property,
                property: populatedContract.property ? {
                    title: populatedContract.property.title,
                    address: populatedContract.property.address
                } : null,
                buyerId: contractData.buyer,
                buyer: populatedContract.buyer ? {
                    name: populatedContract.buyer.name,
                    phone: populatedContract.buyer.phone
                } : null,
                sellerId: contractData.seller,
                seller: populatedContract.seller ? {
                    name: populatedContract.seller.name,
                    phone: populatedContract.seller.phone
                } : null,
                contractAmount: contractData.contractAmount,
                depositAmount: contractData.depositAmount,
                contractDate: contractData.contractDate,
                agent: populatedContract.agent ? {
                    name: populatedContract.agent.name,
                    email: populatedContract.agent.email
                } : null
            },
            req
        );

        res.status(201).json({
            success: true,
            message: '계약이 성공적으로 등록되었습니다. 관련 일정도 자동으로 생성되었습니다.',
            data: populatedContract
        });
    } catch (error) {
        console.error('계약 등록 오류:', error);
        res.status(500).json({
            success: false,
            message: '계약 등록 중 오류가 발생했습니다.'
        });
    }
};

// 계약 수정
const updateContract = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;
        const updateData = req.body;

        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({
                success: false,
                message: '계약을 찾을 수 없습니다.'
            });
        }

        // 권한 확인 - byCompanyNumber 기반으로 변경
        if (user.level < 5) {
            // Level 5 미만은 자신이 등록한 계약만 수정
            if (contract.publisher.toString() !== user._id.toString()) {
                return res.status(403).json({
                    success: false,
                    message: '해당 계약을 수정할 권한이 없습니다.'
                });
            }
        } else {
            // Level 5 이상은 같은 사업자 번호의 계약만 수정
            if (contract.byCompanyNumber !== user.businessNumber) {
                return res.status(403).json({
                    success: false,
                    message: '해당 계약을 수정할 권한이 없습니다.'
                });
            }
        }

        // 완료된 계약 수정 방지
        if (contract.status === '완료') {
            return res.status(400).json({
                success: false,
                message: '완료된 계약은 수정할 수 없습니다.'
            });
        }

        // 매수자 정보 처리 (Customer ID만 사용)
        if (updateData.buyer) {
            const buyerCustomer = await Customer.findById(updateData.buyer);
            if (!buyerCustomer) {
                return res.status(400).json({
                    success: false,
                    message: '선택한 매수자 고객을 찾을 수 없습니다.'
                });
            }
        }

        // 매도자 정보 처리 (Customer ID만 사용)
        if (updateData.seller) {
            const sellerCustomer = await Customer.findById(updateData.seller);
            if (!sellerCustomer) {
                return res.status(400).json({
                    success: false,
                    message: '선택한 매도자 고객을 찾을 수 없습니다.'
                });
            }
        }

        // 매물 정보 처리
        if (updateData.property) {
            // property가 객체인 경우 _id만 추출
            if (typeof updateData.property === 'object' && updateData.property._id) {
                updateData.property = updateData.property._id;
            }
        }

        // 계약 유형별 필드 검증
        if (updateData.type === '매매') {
            if (!updateData.price) {
                return res.status(400).json({
                    success: false,
                    message: '매매 계약의 경우 매매가격은 필수입니다.'
                });
            }
        } else if (updateData.type === '월세') {
            if (!updateData.price || !updateData.deposit) {
                return res.status(400).json({
                    success: false,
                    message: '월세 계약의 경우 월세와 보증금은 필수입니다.'
                });
            }
        } else if (updateData.type === '전세') {
            if (!updateData.price) {
                return res.status(400).json({
                    success: false,
                    message: '전세 계약의 경우 전세가격은 필수입니다.'
                });
            }
        }

        // 매물 소유권 이전 처리 (계약 수정 시) - 매매 계약이고 완료 상태일 때만 실행
        const contractType = updateData.type || contract.type;
        if (updateData.status === '완료' && contract.status !== '완료' && contractType === '매매') {
            // 계약 상태가 완료로 변경되는 경우 매물 소유권 이전
            const propertyId = updateData.property || contract.property;
            const property = await Property.findById(propertyId);
            
            if (property) {
                const sellerId = updateData.seller || contract.seller;
                const buyerId = updateData.buyer || contract.buyer;

                // 매도자의 properties 배열에서 해당 매물 제거
                await Customer.findByIdAndUpdate(sellerId, {
                    $pull: { 
                        properties: { property: propertyId },
                        propertyHistory: { property: propertyId }
                    }
                });

                // 매수자의 properties 배열에 매물 추가
                const buyerCustomer = await Customer.findById(buyerId);
                if (buyerCustomer) {
                    await Customer.findByIdAndUpdate(buyerId, {
                        $push: {
                            properties: {
                                property: propertyId,
                                askingPrice: null,
                                monthlyRent: null,
                                deposit: null,
                                jeonseDeposit: null,
                                addedAt: new Date()
                            },
                            propertyHistory: {
                                property: propertyId,
                                propertyTitle: property.title,
                                changeDate: new Date(),
                                changeType: '추가',
                                changedBy: user._id,
                                newOwner: buyerId
                            }
                        }
                    });
                }

                // 매물의 customer 필드 업데이트
                property.customer = buyerId;
                property.customerHistory.push({
                    customer: buyerId,
                    customerName: buyerCustomer.name,
                    customerPhone: buyerCustomer.phone,
                    changeDate: new Date(),
                    changeType: '소유자 변경',
                    changedBy: user._id,
                    previousOwner: sellerId,
                    newOwner: buyerId
                });

                // 계약이 완료 상태인 경우 매물 상태도 변경
                property.status = '판매완료';

                await property.save();
                
            }
        } else if (updateData.property && contract.property?.toString() !== updateData.property && updateData.status === '완료' && contractType === '매매') {
            // 매물이 변경되면서 동시에 완료 상태로 변경되는 경우
            const property = await Property.findById(updateData.property);
            if (property) {
                // 이전 매물이 있었다면 이전 소유자에서 제거
                if (contract.property && contract.property.toString() !== updateData.property) {
                    await Customer.findByIdAndUpdate(contract.seller, {
                        $pull: { 
                            properties: { property: contract.property },
                            propertyHistory: { property: contract.property }
                        }
                    });
                }

                // 새로운 매물을 매도자에서 제거하고 매수자에게 추가
                const sellerId = updateData.seller || contract.seller;
                const buyerId = updateData.buyer || contract.buyer;

                // 매도자의 properties 배열에서 해당 매물 제거
                await Customer.findByIdAndUpdate(sellerId, {
                    $pull: { 
                        properties: { property: updateData.property },
                        propertyHistory: { property: updateData.property }
                    }
                });

                // 매수자의 properties 배열에 매물 추가
                const buyerCustomer = await Customer.findById(buyerId);
                if (buyerCustomer) {
                    await Customer.findByIdAndUpdate(buyerId, {
                        $push: {
                            properties: {
                                property: updateData.property,
                                askingPrice: null,
                                monthlyRent: null,
                                deposit: null,
                                jeonseDeposit: null,
                                addedAt: new Date()
                            },
                            propertyHistory: {
                                property: updateData.property,
                                propertyTitle: property.title,
                                changeDate: new Date(),
                                changeType: '추가',
                                changedBy: user._id,
                                newOwner: buyerId
                            }
                        }
                    });
                }

                // 매물의 customer 필드 업데이트
                property.customer = buyerId;
                property.customerHistory.push({
                    customer: buyerId,
                    customerName: buyerCustomer.name,
                    customerPhone: buyerCustomer.phone,
                    changeDate: new Date(),
                    changeType: '소유자 변경',
                    changedBy: user._id,
                    previousOwner: sellerId,
                    newOwner: buyerId
                });

                // 계약이 완료 상태인 경우 매물 상태도 변경
                property.status = '판매완료';

                await property.save();
            }
        } else if (updateData.property && contract.property?.toString() !== updateData.property && updateData.status !== '완료') {
            // 계약이 완료되지 않은 상태에서 매물이 변경된 경우 경고 로그
        }

        // byCompanyNumber 업데이트 추가
        updateData.byCompanyNumber = user.businessNumber || '';

        const updatedContract = await Contract.findByIdAndUpdate(
            id,
            updateData,
            { new: true }
        )
        .populate('buyer', 'name phone email')
        .populate('seller', 'name phone email')
        .populate('publisher', 'name')
        .populate('agent', 'name email phone');

        // 매물 상태 업데이트
        if (updateData.property || updateData.type || updateData.status) {
            const propertyId = updateData.property || contract.property;
            if (propertyId) {
                const property = await Property.findById(propertyId);
                if (property) {
                    const contractType = updateData.type || contract.type;
                    const contractStatus = updateData.status || contract.status;
                    
                    let newStatus = '';
                    
                    // 계약 유형에 따른 매물 상태 설정
                    if (contractType === '매매') {
                        newStatus = contractStatus === '완료' ? '판매완료' : '판매중';
                    } else if (contractType === '월세') {
                        newStatus = contractStatus === '완료' ? '월세완료' : '월세중';
                    } else if (contractType === '전세') {
                        newStatus = contractStatus === '완료' ? '전세완료' : '전세중';
                    } else {
                        // 기타 유형의 경우
                        newStatus = contractStatus === '완료' ? '계약완료' : '계약중';
                    }
                    
                    // 매물 상태 업데이트
                    const previousStatus = property.status;
                    property.status = newStatus;
                    
                    // 매물 수정 히스토리에 계약 정보 추가
                    const modificationEntry = {
                        modifiedBy: user._id,
                        modifiedAt: new Date(),
                        modificationType: '계약수정',
                        previousStatus: previousStatus,
                        newStatus: newStatus,
                        contractDetails: {
                            contractNumber: updateData.contractNumber || contract.contractNumber,
                            contractType: contractType,
                            contractStatus: contractStatus,
                            price: updateData.price || contract.price,
                            deposit: updateData.deposit || contract.deposit,
                            commission: updateData.commission || contract.commission,
                            contractDate: updateData.contractDate || contract.contractDate,
                            closingDate: updateData.closingDate || contract.closingDate,
                            startDate: updateData.startDate || contract.startDate,
                            endDate: updateData.endDate || contract.endDate,
                            buyer: updateData.buyer || contract.buyer,
                            seller: updateData.seller || contract.seller,
                            agent: updateData.agent || contract.agent
                        },
                        description: `계약번호: ${updateData.contractNumber || contract.contractNumber}, 유형: ${contractType}, 상태: ${contractStatus}${(updateData.startDate || contract.startDate) && (updateData.endDate || contract.endDate) ? `, 기간: ${new Date(updateData.startDate || contract.startDate).toLocaleDateString('ko-KR')} ~ ${new Date(updateData.endDate || contract.endDate).toLocaleDateString('ko-KR')}` : ''}`
                    };
                    
                    property.modificationHistory.push(modificationEntry);
                    await property.save();
                    
                }
            }
        }

        // 계약 수정 시 관련 일정 업데이트
        await updateContractSchedule(updatedContract, user);

        const savedContract = await Contract.findById(updatedContract._id)
            .populate('buyer', 'name phone email')
            .populate('seller', 'name phone email')
            .populate('publisher', 'name')
            .populate('agent', 'name email phone');

        // 활동기록 로깅
        await logContractActivity(
            '계약 수정',
            `${savedContract.type} 계약이 수정되었습니다.`,
            user._id,
            user.name || user.email,
            savedContract._id,
            savedContract.type,
            {
                updatedFields: Object.keys(updateData),
                propertyId: savedContract.property,
                buyerId: savedContract.buyer,
                sellerId: savedContract.seller,
                status: savedContract.status
            },
            req
        );

        res.json({
            success: true,
            message: '계약이 성공적으로 수정되었습니다. 관련 일정도 업데이트되었습니다.',
            data: savedContract
        });
    } catch (error) {
        console.error('계약 수정 오류:', error);
        res.status(500).json({
            success: false,
            message: '계약 수정 중 오류가 발생했습니다.'
        });
    }
};

// 계약 삭제
const deleteContract = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;

        const contract = await Contract.findById(id);
        if (!contract) {
            return res.status(404).json({
                success: false,
                message: '계약을 찾을 수 없습니다.'
            });
        }

        // 권한 확인: 레벨 5 이상이거나 당사자(매수자/매도자)인 경우에만 삭제 가능
        const isHighLevel = user.level >= 5;
        const isPublisher = contract.publisher.toString() === user._id.toString();
        const isBuyer = contract.buyer && contract.buyer.toString() === user._id.toString();
        const isSeller = contract.seller && contract.seller.toString() === user._id.toString();
        
        if (!isHighLevel && !isPublisher && !isBuyer && !isSeller) {
            return res.status(403).json({
                success: false,
                message: '해당 계약을 삭제할 권한이 없습니다.'
            });
        }

        // 삭제 전에 계약 정보를 populate해서 가져오기
        const populatedContract = await Contract.findById(id)
            .populate('property', 'title address')
            .populate('buyer', 'name phone email')
            .populate('seller', 'name phone email')
            .populate('agent', 'name email phone');

        // 활동기록 로깅 (삭제 전에 로깅)
        await logContractActivity(
            '계약 삭제',
            `${contract.type} 계약이 삭제되었습니다.`,
            user._id,
            user.name || user.email,
            contract._id,
            contract.type,
            {
                type: contract.type,
                status: contract.status,
                contractNumber: contract.contractNumber,
                propertyId: contract.property,
                property: populatedContract?.property ? {
                    title: populatedContract.property.title,
                    address: populatedContract.property.address
                } : null,
                buyerId: contract.buyer,
                buyer: populatedContract?.buyer ? {
                    name: populatedContract.buyer.name,
                    phone: populatedContract.buyer.phone
                } : null,
                sellerId: contract.seller,
                seller: populatedContract?.seller ? {
                    name: populatedContract.seller.name,
                    phone: populatedContract.seller.phone
                } : null,
                contractAmount: contract.contractAmount,
                depositAmount: contract.depositAmount,
                contractDate: contract.contractDate,
                agent: populatedContract?.agent ? {
                    name: populatedContract.agent.name,
                    email: populatedContract.agent.email
                } : null,
                reason: '사용자 요청에 의한 삭제'
            },
            req
        );

        await Contract.findByIdAndDelete(id);

        res.json({
            success: true,
            message: '계약이 성공적으로 삭제되었습니다.'
        });
    } catch (error) {
        console.error('계약 삭제 오류:', error);
        res.status(500).json({
            success: false,
            message: '계약 삭제 중 오류가 발생했습니다.'
        });
    }
};

// 계약용 고객 목록 조회 (Level 조건에 따른 필터링)
const getCustomersForContract = async (req, res) => {
    try {
        const user = req.user;
        const { type, search } = req.query;

        let query = {};

        // 고객 타입 필터
        if (type) {
            if (type === 'buyer') {
                query.type = '매수자';
            } else if (type === 'seller') {
                query.type = '매도자';
            }
        }

        // Level 조건에 따른 필터링
        if (user.level >= 11) {
            // Level 11 이상은 모든 고객 조회 가능
        } else {
            // Level 11 미만은 자신이 등록한 고객만 조회
            query.publisher = user._id;
        }

        // 검색 조건 (Level 필터링 이후에 적용)
        if (search) {
            query.$and = [
                query,
                {
                    $or: [
                        { name: { $regex: search, $options: 'i' } },
                        { phone: { $regex: search, $options: 'i' } },
                        { email: { $regex: search, $options: 'i' } }
                    ]
                }
            ];
            delete query.publisher;
            delete query.type;
        }

        const customers = await Customer.find(query)
            .populate('publisher', 'name businessNumber')
            .sort({ name: 1 })
            .limit(50); // 최대 50개까지만 조회

        res.json({
            success: true,
            data: customers
        });
    } catch (error) {
        console.error('계약용 고객 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '고객 목록을 불러오는 중 오류가 발생했습니다.'
        });
    }
};

// 계약용 사용자 목록 조회 (담당자 선택용)
const getUsersForContract = async (req, res) => {
    try {
        const user = req.user;
        
        // Level 11 이상은 모든 사용자 조회, 그 이하는 같은 사업자 번호 사용자만 조회
        let query = { isDeleted: false };
        
        if (user.level < 11) {
            query.businessNumber = user.businessNumber;
        }

        const users = await User.find(query)
            .select('name email phone businessNumber level')
            .sort({ name: 1 });

        res.json({
            success: true,
            data: users
        });
    } catch (error) {
        console.error('사용자 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '사용자 목록을 불러오는 중 오류가 발생했습니다.'
        });
    }
};

// 계약 등록 시 자동으로 일정 생성하는 함수
const createContractSchedule = async (contract, user) => {
    try {
        // 매수자와 매도자 정보 가져오기
        const buyer = await Customer.findById(contract.buyer);
        const seller = await Customer.findById(contract.seller);
        
        // 계약 정보를 기반으로 일정 데이터 생성 (하나의 통합된 일정)
        const scheduleData = {
            title: `[${contract.type}] ${contract.contractNumber || '계약'} 관리`,
            type: '계약관리',
            date: contract.contractDate,
            time: '09:00', // 기본 시간 설정
            location: '사무실',
            description: `계약번호: ${contract.contractNumber || '생성중'}\n계약유형: ${contract.type}\n매수자: ${buyer ? buyer.name : 'N/A'}\n매도자: ${seller ? seller.name : 'N/A'}`,
            priority: '높음',
            status: '예정',
            relatedCustomers: [contract.buyer, contract.seller], // 매수자와 매도자 모두 연결
            relatedProperties: [contract.property], // 관련 매물 연결
            relatedContracts: [contract._id], // 관련 계약 연결
            publisher: user._id
        };

        // 계약 상태에 따른 일정 조정
        if (contract.status === '완료') {
            scheduleData.status = '완료';
            scheduleData.completedAt = new Date();
        } else if (contract.status === '취소') {
            scheduleData.status = '취소';
            scheduleData.cancelReason = '계약 취소';
        }

        // 일정 생성
        const schedule = new Schedule(scheduleData);
        await schedule.save();

        
        return schedule;
    } catch (error) {
        console.error('계약 일정 자동 생성 오류:', error);
        // 일정 생성 실패해도 계약 등록은 성공으로 처리
        return null;
    }
};

// 계약 수정 시 관련 일정 업데이트하는 함수
const updateContractSchedule = async (contract, user) => {
    try {
        // 계약과 연결된 일정 찾기 (하나의 통합된 일정만)
        const schedule = await Schedule.findOne({ 
            relatedContracts: contract._id,
            type: '계약관리'
        });
        
        if (schedule) {
            // 매수자와 매도자 정보 가져오기
            const buyer = await Customer.findById(contract.buyer);
            const seller = await Customer.findById(contract.seller);

            // 일정 데이터 업데이트
            const scheduleData = {
                title: `[${contract.type}] ${contract.contractNumber || '계약'} 관리`,
                date: contract.contractDate,
                description: `계약번호: ${contract.contractNumber}\n계약유형: ${contract.type}\n매수자: ${buyer ? buyer.name : 'N/A'}\n매도자: ${seller ? seller.name : 'N/A'}`,
                relatedCustomers: [contract.buyer, contract.seller],
                relatedProperties: [contract.property]
            };

            // 계약 상태에 따른 일정 조정
            if (contract.status === '완료') {
                scheduleData.status = '완료';
                scheduleData.completedAt = new Date();
            } else if (contract.status === '취소') {
                scheduleData.status = '취소';
                scheduleData.cancelReason = '계약 취소';
            } else {
                scheduleData.status = '예정';
            }

            // 일정 업데이트
            await Schedule.findByIdAndUpdate(schedule._id, scheduleData, { new: true });
        } else {
            // 계약 등록 시 자동으로 생성된 일정이 없는 경우 새로 생성
            await createContractSchedule(contract, user);
        }
    } catch (error) {
        console.error('계약 일정 업데이트 오류:', error);
    }
};



module.exports = {
    getContracts,
    getContractById,
    createContract,
    updateContract,
    deleteContract,
    getCustomersForContract,
    getUsersForContract
};
