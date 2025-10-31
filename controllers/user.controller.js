const User = require('../models/user.model.js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();

const saltRounds = 10;
const userController = {};

const generateToken = (userId, sessionId = null) => {
    const payload = { _id: userId };
    if (sessionId) {
        payload.sessionId = sessionId;
    }
    // return jwt.sign(payload, process.env.JWT_SECRET_KEY, { expiresIn: '1h' });
    return jwt.sign(payload, process.env.JWT_SECRET_KEY); // 만료 시간 제거
};

// 비밀번호 해시 함수
const hashPassword = async (password) => {
    const salt = await bcrypt.genSalt(saltRounds);
    const hash = await bcrypt.hash(password, salt);
    return hash;
};

// 이메일 인증을 위한 함수
const sendVerificationEmail = (email, token) => {
    const transporter = nodemailer.createTransport({
        service: 'Gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Email Verification',
        html: `<h1>이메일 인증</h1><p>인증하려면 <a href="http://yourdomain.com/verify-email?token=${token}">여기</a>를 클릭하세요.</p>`,
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
        } else {
    
        }
    });
};


userController.createUser = async (req, res) => {
    try {

        const { email, name, nickname, contactNumber, birthDate, gender, position, password, companyName, businessNumber, businessAddress, detailedAddress, level } = req.body;

        // 이메일 중복 확인
        const existingActiveUser = await User.findOne({ email, isDeleted: false });
        if (existingActiveUser) {
            throw new Error('이미 가입된 유저입니다.');
        }

        const hash = await hashPassword(password);

        // birthDate 형식 변환 (YYYY-MM-DD -> Date 객체)
        let formattedBirthDate = null;
        if (birthDate && birthDate.trim() !== '') {
            // YYYY-MM-DD 형식인지 확인
            if (birthDate.includes('-')) {
                const dateParts = birthDate.split('-');
                if (dateParts.length === 3) {
                    formattedBirthDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
                }
            } else if (birthDate.includes('.')) {
                // 기존 YYYY.MM.DD 형식도 지원
                const dateParts = birthDate.split('.');
                if (dateParts.length === 3) {
                    formattedBirthDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
                }
            }
        }

        const newUser = new User({
            email,
            name,
            nickname,
            contactNumber,
            birthDate: formattedBirthDate,
            gender,
            position,
            password: hash,
            companyName,
            businessNumber: businessNumber || '',
            businessAddress,
            detailedAddress,
            level,
            isVerified: true, // 프론트엔드에서 이미 인증 완료된 상태
        });

        await newUser.save();

        res.status(200).json({ status: 'success', message: '계정이 생성되었습니다.' });
    } catch (error) {
        res.status(400).json({ status: 'fail', error: error.message });
    }
};





userController.getUserById = async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await User.findById(userId).select('-password');

        if (!user) {
            return res.status(200).json({ status: 'fail', message: '사용자를 찾을 수 없습니다.' });
        }

        res.status(200).json({ status: 'success', data: user });
    } catch (error) {
        res.status(400).json({ status: 'fail', error: error.message });
    }
};

// 사용자 삭제 (deleteUser)
userController.deleteUserByAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const adminUserId = req.userId; // 인증된 관리자 ID

        // 관리자 정보 조회
        const adminUser = await User.findById(adminUserId);
        if (!adminUser) {
            return res.status(404).json({ status: 'fail', message: '관리자 정보를 찾을 수 없습니다.' });
        }

        // 대상 사용자 정보 조회
        const targetUser = await User.findById(id);
        if (!targetUser) {
            return res.status(404).json({ status: 'fail', message: '삭제할 사용자를 찾을 수 없습니다.' });
        }

        // 권한 체크: 같은 사업자 번호이고 level 5 이상이어야 함
        if (adminUser.businessNumber !== targetUser.businessNumber) {
            return res.status(403).json({ status: 'fail', message: '같은 사업자 번호의 사용자만 삭제할 수 있습니다.' });
        }

        if (adminUser.level < 5) {
            return res.status(403).json({ status: 'fail', message: '레벨 5 이상의 사용자만 다른 사용자를 삭제할 수 있습니다.' });
        }

        // 자기보다 높은 레벨의 사용자는 삭제 불가
        if (targetUser.level >= adminUser.level) {
            return res.status(403).json({ status: 'fail', message: '자기보다 높거나 같은 레벨의 사용자는 삭제할 수 없습니다.' });
        }

        // 사용자 삭제 (실제 삭제 대신 isDeleted 플래그 설정)
        const now = new Date();
        const formattedDateTime = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        
        targetUser.email = `[deleted]_${targetUser.email}_${formattedDateTime}`;
        targetUser.isDeleted = true;
        targetUser.deletedAt = now;
        await targetUser.save();

        // 히스토리 기록
        const History = require('../models/History.model.js');
        const historyEntry = new History({
            author: adminUserId,
            category: 'User',
            categoryDetailID: id,
            content: `${adminUser.name}님이 ${targetUser.name}님을 삭제했습니다.`,
            relatedUsers: [id, adminUserId]
        });
        await historyEntry.save();

        res.status(200).json({ status: 'success', message: '사용자가 성공적으로 삭제되었습니다.' });
    } catch (error) {
        res.status(400).json({ status: 'fail', error: error.message });
    }
};



userController.deleteUser = async (req, res) => {
    try {
        // 인증된 사용자의 ID 사용
        const userId = req.user?._id || req.userId;
        if (!userId) {
            return res.status(400).json({ status: 'fail', message: '사용자 ID를 찾을 수 없습니다.' });
        }

        const { password } = req.body;

        // 사용자 찾기
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ status: 'fail', message: '사용자를 찾을 수 없습니다.' });
        }

        // OAuth 사용자가 아닌 경우에만 비밀번호 검증
        const isOAuthUser = user.isSocialAccount || user.googleId || user.socialProvider === 'google';
        
        if (!isOAuthUser && user.password) {
            if (!password) {
                return res.status(400).json({ status: 'fail', message: '비밀번호를 입력해주세요.' });
            }
            
            const isPasswordCorrect = await bcrypt.compare(password, user.password);
            if (!isPasswordCorrect) {
                return res.status(401).json({ status: 'fail', message: '비밀번호가 올바르지 않습니다.' });
            }
        }

        // 현재 날짜와 시간 가져오기
        const now = new Date();
        const formattedDateTime = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

        // 이메일에 [deleted]_ 접두사와 삭제된 날짜 및 시간 추가
        if (!user.email.startsWith('[deleted]_')) {
            user.email = `[deleted]_${user.email}_${formattedDateTime}`;
        }
        user.isDeleted = true; // 계정 상태 변경
        user.deletedAt = now; // 삭제 일시 기록

        await user.save();

        res.status(200).json({ status: 'success', message: '회원 탈퇴가 완료되었습니다.' });
    } catch (error) {
        res.status(500).json({ status: 'fail', message: '서버 에러가 발생했습니다.', error: error.message });
    }
};




// 로그인 (loginWithEmail)
userController.loginWithEmail = async (req, res) => {
    try {
        const { email, password } = req.body;

        // 이메일로 활성화된 계정(isDeleted: false) 검색
        const user = await User.findOne({ email, isDeleted: false });

        if (!user) {
            return res.status(404).json({ status: 'fail', message: '활성화된 계정을 찾을 수 없습니다.' });
        }

        // 비밀번호 확인
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ status: 'fail', message: '아이디 또는 비밀번호가 일치하지 않습니다.' });
        }

        // 중복 로그인 방지: 기존 세션 무효화
        const wasLoggedIn = user.isLoggedIn;
        
        if (user.isLoggedIn) {
            user.invalidateSession();
            await user.save();
        }

        // 새로운 세션 생성
        const sessionId = user.createSession();
        await user.save();

        // JWT 토큰 생성 (세션 ID 포함)
        const token = generateToken(user._id, sessionId);

        res.status(200).json({ 
            status: 'success', 
            user, 
            token,
            sessionId,
            message: wasLoggedIn ? '다른 기기에서 로그인되어 기존 세션이 종료되었습니다.' : '로그인 성공'
        });
    } catch (error) {
        res.status(500).json({ status: 'fail', message: '서버 오류가 발생했습니다.' });
    }
};

// 구글 OAuth 로그인
userController.googleLogin = async (req, res) => {
    try {
        // MongoDB 연결 상태 확인
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ 
                status: 'fail', 
                message: '데이터베이스 연결이 불안정합니다. 잠시 후 다시 시도해주세요.',
                dbStatus: mongoose.connection.readyState
            });
        }
        
        const { googleId, email, name, nickname, picture } = req.body;

        if (!googleId || !email) {
            return res.status(400).json({ status: 'fail', message: '필수 정보가 누락되었습니다.' });
        }


        // 기존 사용자 검색 (구글 ID 또는 이메일로)
        let user = await User.findOne({
            $or: [
                { googleId: googleId },
                { email: email, isDeleted: false }
            ]
        });


        // 탈퇴된 계정이 있는지 확인
        const deletedUser = await User.findOne({
            email: email,
            isDeleted: true
        });

        if (user) {
            // 기존 사용자가 있는 경우
            if (user.isDeleted) {
                return res.status(200).json({ 
                    status: 'deleted_account', 
                    message: '탈퇴된 계정이 발견되었습니다. 계정을 복구하시겠습니까?',
                    deletedUser: {
                        _id: user._id,
                        email: user.email,
                        name: user.name,
                        level: user.level,
                        companyName: user.companyName,
                        businessNumber: user.businessNumber
                    }
                });
            }

            // 구글 ID가 없으면 추가
            if (!user.googleId) {
                user.googleId = googleId;
                if (picture) user.profilePicture = picture;
                user.isSocialAccount = true; // 구글 OAuth 사용자로 설정
                user.socialProvider = 'google'; // 구글 제공자로 설정
                await user.save();
            }

            // 프로필 정보 업데이트 (프로필 사진만, name은 덮어쓰지 않음)
            if (picture && user.profilePicture !== picture) {
                user.profilePicture = picture;
            }
            await user.save();
        } else if (deletedUser) {
            // 탈퇴된 계정이 있는 경우
            return res.status(200).json({ 
                status: 'deleted_account', 
                message: '탈퇴된 계정이 발견되었습니다. 계정을 복구하시겠습니까?',
                deletedUser: {
                    _id: deletedUser._id,
                    email: deletedUser.email,
                    name: deletedUser.name,
                    level: deletedUser.level,
                    companyName: deletedUser.companyName,
                    businessNumber: deletedUser.businessNumber
                }
            });
        } else {
            // 새 사용자 생성
            const newUser = new User({
                email,
                name: name || email.split('@')[0],
                nickname: nickname || email.split('@')[0],
                googleId,
                profilePicture: picture,
                isVerified: true,
                level: 1, // 기본 레벨
                companyName: '',
                businessNumber: '',
                businessAddress: '',
                detailedAddress: '',
                position: '사원', // 올바른 enum 값 사용
                contactNumber: '',
                birthDate: null,
                gender: 'male', // 올바른 enum 값 사용 (기본값)
                isDeleted: false,
                isSocialAccount: true, // 구글 OAuth 사용자
                socialProvider: 'google' // 구글 제공자
            });

            user = await newUser.save();
        }

        // 중복 로그인 방지: 기존 세션 무효화
        const wasLoggedIn = user.isLoggedIn;
        
        if (user.isLoggedIn) {
            user.invalidateSession();
            await user.save();
        }

        // 새로운 세션 생성
        const sessionId = user.createSession();
        await user.save();

        // JWT 토큰 생성 (세션 ID 포함)
        const token = generateToken(user._id, sessionId);

        res.status(200).json({ 
            status: 'success', 
            user, 
            token,
            sessionId,
            message: wasLoggedIn ? '다른 기기에서 로그인되어 기존 세션이 종료되었습니다.' : '로그인 성공'
        });
    } catch (error) {
        res.status(500).json({ status: 'fail', message: '서버 오류가 발생했습니다.', error: error.message });
    }
};

// Google OAuth 코드 처리
userController.googleOAuth = async (req, res) => {
    try {
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ status: 'fail', message: '인증 코드가 필요합니다.' });
        }

        // Google OAuth 토큰 교환
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: `${process.env.FRONTEND_URL || 'http://localhost:3000'}`
            })
        });

        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.json();
            throw new Error(`Google OAuth 토큰 교환 실패: ${errorData.error_description || errorData.error}`);
        }

        const tokenData = await tokenResponse.json();
        const { access_token } = tokenData;

        if (!access_token) {
            throw new Error('Google 액세스 토큰을 받을 수 없습니다.');
        }

        // Google 사용자 정보 조회
        const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                'Authorization': `Bearer ${access_token}`
            }
        });

        if (!profileResponse.ok) {
            throw new Error('Google 사용자 정보 조회 실패');
        }

        const profileData = await profileResponse.json();
        const { id: googleId, email, name, picture } = profileData;

        if (!googleId || !email) {
            throw new Error('Google 사용자 정보가 불완전합니다.');
        }

        // 기존 사용자 검색
        let user = await User.findOne({
            $or: [
                { googleId: googleId },
                { email: email, isDeleted: false }
            ]
        });

        // 탈퇴된 계정이 있는지 확인
        const deletedUser = await User.findOne({
            email: email,
            isDeleted: true
        });

        if (user) {
            // 기존 사용자가 있는 경우
            if (user.isDeleted) {
                return res.status(200).json({ 
                    status: 'deleted_account', 
                    message: '탈퇴된 계정이 발견되었습니다. 계정을 복구하시겠습니까?',
                    deletedUser: {
                        _id: user._id,
                        email: user.email,
                        name: user.name,
                        level: user.level,
                        companyName: user.companyName,
                        businessNumber: user.businessNumber
                    }
                });
            }

            // 구글 ID가 없으면 추가
            if (!user.googleId) {
                user.googleId = googleId;
                if (picture) user.profilePicture = picture;
                user.isSocialAccount = true;
                user.socialProvider = 'google';
                await user.save();
            }

            // 프로필 정보 업데이트
            if (picture && user.profilePicture !== picture) {
                user.profilePicture = picture;
            }
            await user.save();

        } else if (deletedUser) {
            // 탈퇴된 계정이 있는 경우
            return res.status(200).json({ 
                status: 'deleted_account', 
                message: '탈퇴된 계정이 발견되었습니다. 계정을 복구하시겠습니까?',
                deletedUser: {
                    _id: deletedUser._id,
                    email: deletedUser.email,
                    name: deletedUser.name,
                    level: deletedUser.level,
                    companyName: deletedUser.companyName,
                    businessNumber: deletedUser.businessNumber
                }
            });
        } else {
            // 새 사용자 생성
            const newUser = new User({
                email: email,
                name: name || '',
                nickname: name || '',
                profilePicture: picture || '',
                googleId: googleId,
                level: 1,
                coins: 0,
                requestList: [],
                proposalList: [],
                ReceiveList: [],
                position: '직원',
                contactNumber: '',
                birthDate: null,
                gender: 'male',
                isDeleted: false,
                isVerified: true,
                isSocialAccount: true,
                socialProvider: 'google',
                isPremium: false,
                subscriptionStatus: 'inactive'
            });

            user = await newUser.save();
        }

        // JWT 토큰 생성
        const token = generateToken(user._id);

        res.status(200).json({ status: 'success', user, token });
    } catch (error) {
        res.status(500).json({ status: 'fail', message: '서버 오류가 발생했습니다.', error: error.message });
    }
};

// 네이버 OAuth 로그인
userController.naverLogin = async (req, res) => {
    try {
        const { code, state, redirectUri: clientRedirectUri } = req.body;

        if (!code || !state) {
            return res.status(400).json({ status: 'fail', message: '필수 인증 정보가 누락되었습니다.' });
        }

        // 네이버 액세스 토큰 발급 요청
        if (!process.env.NAVER_CLIENT_ID || !process.env.NAVER_CLIENT_SECRET) {
            throw new Error('NAVER_CLIENT_ID 또는 NAVER_CLIENT_SECRET 환경 변수가 설정되지 않았습니다.');
        }

        // 프론트에서 전달된 redirectUri가 있으면 우선 사용, 없으면 환경변수 사용
        const redirectURI = clientRedirectUri || process.env.NAVER_CALLBACK_URL;
        if (!redirectURI) {
            throw new Error('NAVER_CALLBACK_URL 또는 client redirectUri가 필요합니다.');
        }
        const tokenResponse = await fetch('https://nid.naver.com/oauth2.0/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: process.env.NAVER_CLIENT_ID,
                client_secret: process.env.NAVER_CLIENT_SECRET,
                code: code,
                state: state,
                redirect_uri: redirectURI
            })
        });

        if (!tokenResponse.ok) {
            throw new Error('네이버 액세스 토큰 발급 실패');
        }

        const tokenData = await tokenResponse.json();
        const { access_token } = tokenData;

        if (!access_token) {
            throw new Error('네이버 액세스 토큰을 받을 수 없습니다.');
        }

        // 네이버 사용자 프로필 조회
        const profileResponse = await fetch('https://openapi.naver.com/v1/nid/me', {
            headers: {
                'Authorization': `Bearer ${access_token}`,
                'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID,
                'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET
            }
        });

        if (!profileResponse.ok) {
            throw new Error('네이버 프로필 조회 실패');
        }

        const profileData = await profileResponse.json();
        const naverUser = profileData.response;

        if (!naverUser) {
            throw new Error('네이버 사용자 정보를 받을 수 없습니다.');
        }

        
                const { id: naverId, email, nickname, name, profile_image, age, birthday, birthyear } = naverUser;
        
        // 네이버 이메일을 네이버 도메인으로 변환
        let naverEmail = email;
        if (email && email.includes('@')) {
            const emailParts = email.split('@');
            const username = emailParts[0];
            naverEmail = `${username}@naver.com`;
        }
        
        // 기존 사용자 검색 (네이버 ID로만 검색)
        let user = await User.findOne({ naverId: naverId });
        
        // 기존 계정과 연동하지 않고 항상 새로운 네이버 계정 생성
        // 이메일로 검색하는 부분 제거

        // 탈퇴된 계정이 있는지 확인
        const deletedUser = await User.findOne({
            email: email,
            isDeleted: true
        });

        if (user) {
            // 기존 네이버 계정이 있는 경우 (매우 드문 경우)
            if (user.isDeleted) {
                return res.status(200).json({ 
                    status: 'deleted_account', 
                    message: '탈퇴된 계정이 발견되었습니다. 계정을 복구하시겠습니까?',
                    deletedUser: {
                        _id: user._id,
                        email: user.email,
                        businessNumber: user.businessNumber
                    }
                });
            }

            // 기존 네이버 계정 정보 업데이트
            
            // 프로필 정보만 업데이트
            if (nickname && nickname !== user.nickname) {
                user.nickname = nickname;
            }
            if (name && name !== user.name) {
                user.name = name;
            }
            if (profile_image && profile_image !== user.profilePicture) {
                user.profilePicture = profile_image;
            }
            
            await user.save();

        } else {
            // 새 사용자 생성 - 필수 정보 없이 생성
            const newUser = new User({
                email: naverEmail,  // 변환된 네이버 이메일 사용
                name: name || nickname,
                nickname: nickname || name,
                profilePicture: profile_image || '',
                naverId: naverId,
                level: 1,
                coins: 0,
                requestList: [],
                proposalList: [],
                ReceiveList: [],
                position: '사원', // 올바른 enum 값 사용
                contactNumber: '',
                birthDate: null,
                gender: 'male', // 올바른 enum 값 사용 (기본값)
                isDeleted: false,
                isVerified: true,
                isSocialAccount: true,
                socialProvider: 'naver',
                isPremium: false,
                subscriptionStatus: 'inactive'
                // 필수 정보는 RegisterPage에서 입력받음
            });

            user = await newUser.save();
        }

        // 중복 로그인 방지: 기존 세션 무효화
        const wasLoggedIn = user.isLoggedIn;
        
        if (user.isLoggedIn) {
            user.invalidateSession();
            await user.save();
        }

        // 새로운 세션 생성
        const sessionId = user.createSession();
        await user.save();

        // JWT 토큰 생성 (세션 ID 포함)
        const token = generateToken(user._id, sessionId);

        res.status(200).json({ 
            status: 'success', 
            user, 
            token,
            sessionId,
            message: wasLoggedIn ? '다른 기기에서 로그인되어 기존 세션이 종료되었습니다.' : '로그인 성공'
        });
    } catch (error) {
        res.status(500).json({ status: 'fail', message: '서버 오류가 발생했습니다.', error: error.message });
    }
};


// 사용자 정보 가져오기 (getUser)
userController.getUser = async (req, res) => {
    try {
        const { userId } = req;
        const user = await User.findById(userId);
        if (!user) {
            throw new Error('can not find User');
        }
        res.status(200).json({ status: 'success', user });
    } catch (error) {
        res.status(400).json({ status: 'fail', error: error.message });
    }
};

userController.getUserInfo = async (req, res) => {
    try {
        const user = await User.findById(req.userId).select('-password'); // 비밀번호는 제외
        res.json(user);
    } catch (error) {
        res.status(500).send('Server Error');
    }
};

userController.getUsers = async (req, res) => {
    try {
        const adminUserId = req.userId; // 인증된 관리자 ID
        
        // 관리자 정보 조회
        const adminUser = await User.findById(adminUserId);
        if (!adminUser) {
            return res.status(404).json({ status: 'fail', message: '관리자 정보를 찾을 수 없습니다.' });
        }

        // level 1은 접근 불가
        if (adminUser.level < 2) {
            return res.status(403).json({ status: 'fail', message: '레벨 2 이상의 사용자만 다른 사용자 정보를 조회할 수 있습니다.' });
        }

        // 같은 사업자 번호의 사용자만 조회
        const users = await User.find({ 
            businessNumber: adminUser.businessNumber,
            isDeleted: false 
        }).select('-password');

        // level 2-4는 기본 정보만, level 5 이상은 모든 정보
        let filteredUsers = users;
        if (adminUser.level < 5) {
            filteredUsers = users.map(user => ({
                _id: user._id,
                name: user.name,
                nickname: user.nickname,
                email: user.email,
                companyName: user.companyName,
                businessNumber: user.businessNumber,
                level: user.level,
                createdAt: user.createdAt
            }));
        }

        res.status(200).json({ status: 'success', data: filteredUsers });
    } catch (error) {
        res.status(400).json({ status: 'fail', error: error.message });
    }
};

// 플랫폼 운영자용 - 모든 사용자 조회
userController.getAllUsers = async (req, res) => {
    try {
        const adminUserId = req.userId;
        
        // 관리자 정보 조회
        const adminUser = await User.findById(adminUserId);
        if (!adminUser) {
            return res.status(404).json({ status: 'fail', message: '관리자 정보를 찾을 수 없습니다.' });
        }

        // hyin9414@gmail.com 또는 플랫폼 운영자 권한 체크 (레벨 99 이상)
        if (adminUser.email !== 'hyin9414@gmail.com' && adminUser.level < 99) {
            return res.status(403).json({ status: 'fail', message: '특별 관리자 또는 플랫폼 운영자만 모든 사용자 정보를 조회할 수 있습니다.' });
        }

        // 모든 사용자 조회 (삭제되지 않은 사용자)
        const users = await User.find({ 
            isDeleted: false 
        }).select('-password');

        res.status(200).json({ status: 'success', data: users });
    } catch (error) {
        res.status(400).json({ status: 'fail', error: error.message });
    }
};


userController.updateUser = async (req, res) => {
    try {
        // req.user 또는 req.userId에서 사용자 ID 가져오기
        const userId = req.user?._id || req.userId;
        if (!userId) {
            throw new Error("사용자 ID를 찾을 수 없습니다.");
        }
        
        const { name, nickname, contactNumber, birthDate, gender, position, companyName, businessNumber, businessAddress, detailedAddress } = req.body;
        
        
        // 현재 사용자 정보 조회
        const currentUser = await User.findById(userId);
        if (!currentUser) {
            throw new Error("User not found");
        }
        
        
        // 사업자 번호가 변경되었는지 확인 (하이픈 제거 후 비교)
        const currentBusinessNumber = currentUser.businessNumber ? currentUser.businessNumber.replace(/[^0-9]/g, '') : '';
        const newBusinessNumber = businessNumber ? businessNumber.replace(/[^0-9]/g, '') : '';
        const businessNumberChanged = currentBusinessNumber !== newBusinessNumber;
        
        
        // 업데이트할 데이터 준비 (undefined 값은 제외)
        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (nickname !== undefined) updateData.nickname = nickname;
        if (contactNumber !== undefined) updateData.contactNumber = contactNumber;
        if (birthDate !== undefined) {
            // 생년월일에서 시간 정보 제거하고 날짜만 저장
            if (birthDate && typeof birthDate === 'string') {
                // YYYY-MM-DD 형식인지 확인하고 시간 부분 제거
                const dateOnly = birthDate.split('T')[0];
                updateData.birthDate = dateOnly;
            } else {
                updateData.birthDate = birthDate;
            }
        }
        if (gender !== undefined) updateData.gender = gender;
        if (position !== undefined) updateData.position = position;
        if (companyName !== undefined) updateData.companyName = companyName;
        if (businessNumber !== undefined) {
            // 사업자 번호를 그대로 저장 (하이픈 포함)
            updateData.businessNumber = businessNumber;
        }
        if (businessAddress !== undefined) updateData.businessAddress = businessAddress;
        if (detailedAddress !== undefined) updateData.detailedAddress = detailedAddress;
        
        
        // 사업자 번호가 변경된 경우 레벨을 1로 초기화
        if (businessNumberChanged) {
            updateData.level = 1;
        }
        
        const user = await User.findByIdAndUpdate(userId, updateData, { new: true });

        if (!user) {
            throw new Error("User not found");
        }

        

        res.status(200).json({ 
            status: "success", 
            user,
            businessNumberChanged,
            message: businessNumberChanged ? "사용자 정보가 업데이트되었습니다." : "사용자 정보가 업데이트되었습니다."
        });
    } catch (error) {
        res.status(400).json({ status: "fail", error: error.message });
    }
};

userController.checkNicknameAvailability = async (req, res) => {
    try {
        const { nickname } = req.params;  // 요청 파라미터에서 닉네임을 받음
        const user = await User.findOne({ nickname });

        if (user) {
            return res.status(200).json({ status: 'fail', message: '닉네임이 이미 사용 중입니다.' });
        }

        res.status(200).json({ status: 'success', message: '닉네임을 사용할 수 있습니다.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: '서버 오류가 발생했습니다.' });
    }
};


userController.checkEmailAvailability = async (req, res) => {
    try {
        const { email } = req.params;  // 요청 파라미터에서 이메일을 받음
        const user = await User.findOne({ email, isDeleted: false }); // 삭제되지 않은 사용자만 확인

        if (user) {
            return res.status(200).json({ status: 'fail', message: '이미 사용 중인 이메일입니다.' });
        }

        res.status(200).json({ status: 'success', message: '사용 가능한 이메일입니다.' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: '서버 오류가 발생했습니다.' });
    }
};


// 레벨 업데이트 메서드
userController.updateLevel = async (req, res) => {
    try {
        const { userId, level } = req.body; // 요청 본문에서 userId와 level을 추출
        const adminUserId = req.userId; // 인증된 관리자 ID

        // 관리자 정보 조회
        const adminUser = await User.findById(adminUserId);
        if (!adminUser) {
            return res.status(404).json({ status: 'fail', message: '관리자 정보를 찾을 수 없습니다.' });
        }

        // 대상 사용자 정보 조회
        const targetUser = await User.findById(userId);
        if (!targetUser) {
            return res.status(404).json({ status: 'fail', message: '대상 사용자를 찾을 수 없습니다.' });
        }

        // 특별 관리자 권한 체크 (hyin9414@gmail.com)
        const isSpecialAdmin = adminUser.email === 'hyin9414@gmail.com';
        
        // 권한 체크
        if (!isSpecialAdmin && adminUser.level < 5) {
            return res.status(403).json({ status: 'fail', message: '레벨 5 이상의 사용자만 다른 사용자의 레벨을 변경할 수 있습니다.' });
        }

        // 플랫폼 운영자(레벨 99 이상) 또는 특별 관리자는 모든 사용자 레벨 변경 가능
        // 일반 관리자는 같은 사업자 번호의 사용자만 레벨 변경 가능
        if (!isSpecialAdmin && adminUser.level < 99 && adminUser.businessNumber !== targetUser.businessNumber) {
            return res.status(403).json({ status: 'fail', message: '같은 사업자 번호의 사용자만 레벨을 변경할 수 있습니다.' });
        }

        // 특별 관리자가 아닌 경우에만 자기보다 높은 레벨 체크
        if (!isSpecialAdmin && targetUser.level >= adminUser.level) {
            return res.status(403).json({ status: 'fail', message: '자기보다 높거나 같은 레벨의 사용자는 변경할 수 없습니다.' });
        }

        // 레벨 범위 체크 (0-99)
        if (level < 0 || level > 99) {
            return res.status(400).json({ status: 'fail', message: '레벨은 0-99 사이의 값이어야 합니다.' });
        }

        // 레벨 업데이트
        const updatedUser = await User.findByIdAndUpdate(userId, { level }, { new: true });

        // 히스토리 기록
        const History = require('../models/History.model.js');
        const historyEntry = new History({
            author: adminUserId,
            category: 'User',
            categoryDetailID: userId,
            content: `${adminUser.name}님이 ${targetUser.name}님의 레벨을 ${targetUser.level}에서 ${level}로 변경했습니다.${isSpecialAdmin ? ' (특별 관리자 권한)' : ''}`,
            relatedUsers: [userId, adminUserId]
        });
        await historyEntry.save();

        res.status(200).json({ 
            status: 'success', 
            user: updatedUser,
            message: '레벨이 성공적으로 업데이트되었습니다.',
            isSpecialAdmin: isSpecialAdmin
        });
    } catch (error) {
        res.status(400).json({ status: 'fail', error: error.message });
    }
};

userController.updateCoins = async (req, res) => {
    try {
        const { userId, coins } = req.body;

        if (!userId) {
            return res.status(400).json({ status: 'fail', message: 'userId가 제공되지 않았습니다.' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ status: 'fail', message: 'User not found' });
        }

        user.coins += coins;

        if (user.coins < 0) {
            user.coins = 0;
        }

        await user.save();

        res.status(200).json({
            status: 'success',
            message: 'Coins updated successfully',
            coins: user.coins
        });
    } catch (error) {
        res.status(400).json({
            status: 'fail',
            message: 'Failed to update coins',
            error: error.message
        });
    }
};



// user.controller.js

userController.forgotPassword = async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ status: 'fail', message: '등록되지 않은 이메일입니다.' });
        }

        const resetToken = jwt.sign({ _id: user._id }, process.env.JWT_SECRET_KEY);
        const resetLink = `http://yourdomain.com/reset-password?token=${resetToken}`;

        // 비밀번호 재설정 이메일 전송
        await sendResetPasswordEmail(email, resetLink);

        res.status(200).json({ status: 'success', message: '비밀번호 재설정 링크가 이메일로 전송되었습니다.' });
    } catch (error) {
        res.status(500).json({ status: 'fail', message: '비밀번호 재설정 요청을 처리할 수 없습니다.' });
    }
};

// 비밀번호 재설정 함수
userController.resetPassword = async (req, res) => {
    const { token, newPassword } = req.body;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
        const hashedPassword = await hashPassword(newPassword);

        await User.findByIdAndUpdate(decoded._id, { password: hashedPassword });

        res.status(200).json({ status: 'success', message: '비밀번호가 성공적으로 재설정되었습니다.' });
    } catch (error) {
        res.status(400).json({ status: 'fail', message: '비밀번호 재설정에 실패했습니다.' });
    }
};

// 비밀번호 재설정 이메일 전송
const sendResetPasswordEmail = (email, link) => {
    const transporter = nodemailer.createTransport({
        service: 'Gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: '비밀번호 재설정 요청',
        html: `<p>비밀번호를 재설정하려면 <a href="${link}">여기</a>를 클릭하세요.</p>`,
    };

    return transporter.sendMail(mailOptions);
};

// user.controller.js

// 비밀번호 재설정 기능
userController.resetPassword = async (req, res) => {
    const { email, newPassword } = req.body;
    try {
        const hashedPassword = await hashPassword(newPassword);
        const user = await User.findOneAndUpdate({ email }, { password: hashedPassword });

        if (user) {
            res.status(200).json({ message: '비밀번호가 성공적으로 변경되었습니다.' });
        } else {
            res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
        }
    } catch (error) {
        res.status(500).json({ message: '비밀번호 변경에 실패했습니다.' });
    }
};

userController.checkBusinessNumberAvailability = async (req, res) => {
    try {
        const { businessNumber } = req.params;
        
        if (!businessNumber || businessNumber.trim() === '') {
            return res.status(200).json({ 
                status: 'success', 
                message: '사업자 등록번호를 입력해주세요.',
                isFirstEmployee: false 
            });
        }

        // 하이픈 제거하지 않고 그대로 사용
        const cleanBusinessNumber = businessNumber;
        
        // 사업자 등록번호 형식 검증 (10자리 숫자 또는 하이픈 포함 형식)
        const businessRegex = /^[0-9]{3}-[0-9]{2}-[0-9]{5}$|^[0-9]{10}$/;
        if (!businessRegex.test(cleanBusinessNumber)) {
            return res.status(200).json({ 
                status: 'fail', 
                message: '유효한 사업자 등록번호를 입력하세요. (10자리 숫자)',
                isFirstEmployee: false 
            });
        }

        // 해당 사업자 등록번호로 등록된 사용자 검색
        const existingUser = await User.findOne({ 
            businessNumber: cleanBusinessNumber, 
            isDeleted: false 
        });

        // 이미 등록된 사업자 번호인 경우에도 등록 가능하지만, 최초 등록자가 아님
        if (existingUser) {
            return res.status(200).json({ 
                status: 'success', 
                message: '해당 사업자에 추가로 등록됩니다.',
                isFirstEmployee: false 
            });
        }

        // 최초 등록자인지 확인 (해당 사업자 등록번호로 등록된 사용자가 없는 경우)
        const isFirstEmployee = true;

        res.status(200).json({ 
            status: 'success', 
            message: '해당 사업자의 최초 등록자입니다. 해당 업체의 관리자 권한이 부여됩니다.',
            isFirstEmployee: isFirstEmployee
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            message: '서버 오류가 발생했습니다.',
            isFirstEmployee: false 
        });
    }
};

// 탈퇴된 계정 복구
userController.restoreDeletedAccount = async (req, res) => {
    try {
        const { userId, googleId, email, name, picture } = req.body;

        if (!userId || !email) {
            return res.status(400).json({ status: 'fail', message: '필수 정보가 누락되었습니다.' });
        }

        // 탈퇴된 계정 찾기
        const deletedUser = await User.findById(userId);
        if (!deletedUser || !deletedUser.isDeleted) {
            return res.status(404).json({ status: 'fail', message: '탈퇴된 계정을 찾을 수 없습니다.' });
        }

        // 계정 복구
        deletedUser.isDeleted = false;
        deletedUser.deletedAt = null;
        deletedUser.deletedReason = null;
        deletedUser.googleId = googleId;
        deletedUser.isSocialAccount = true;
        deletedUser.socialProvider = 'google';
        deletedUser.level = 1; // 레벨을 1로 초기화
        
        if (picture) {
            deletedUser.profilePicture = picture;
        }

        // 이메일에서 [deleted]_ 접두사 제거
        if (deletedUser.email.startsWith('[deleted]_')) {
            const emailParts = deletedUser.email.split('_');
            if (emailParts.length >= 3) {
                deletedUser.email = emailParts[1]; // 원래 이메일 복원
            }
        }

        await deletedUser.save();

        // JWT 토큰 생성
        const token = generateToken(deletedUser._id);

        res.status(200).json({ 
            status: 'success', 
            message: '계정이 성공적으로 복구되었습니다.',
            user: deletedUser, 
            token 
        });
    } catch (error) {
        res.status(500).json({ status: 'fail', message: '서버 오류가 발생했습니다.', error: error.message });
    }
};


// 프리미엄 상태 업데이트 (관리자용)
userController.updatePremiumStatus = async (req, res) => {
    try {
        const { userId, isPremium } = req.body;
        
        if (!userId) {
            return res.status(400).json({ 
                status: 'fail', 
                message: '사용자 ID가 필요합니다.' 
            });
        }

        // 사용자 찾기
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ 
                status: 'fail', 
                message: '사용자를 찾을 수 없습니다.' 
            });
        }

        // 프리미엄 상태 업데이트
        user.isPremium = isPremium;
        await user.save();

        res.status(200).json({ 
            status: 'success', 
            message: '프리미엄 상태가 성공적으로 업데이트되었습니다.',
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                isPremium: user.isPremium
            }
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            message: '서버 오류가 발생했습니다.' 
        });
    }
};

// 구독 상태 업데이트 (관리자용)
userController.updateSubscriptionStatus = async (req, res) => {
    try {
        const { userId, subscriptionStatus } = req.body;
        
        if (!userId) {
            return res.status(400).json({ 
                status: 'fail', 
                message: '사용자 ID가 필요합니다.' 
            });
        }

        if (!subscriptionStatus) {
            return res.status(400).json({ 
                status: 'fail', 
                message: '구독 상태가 필요합니다.' 
            });
        }

        // 유효한 구독 상태인지 확인
        const validStatuses = ['active', 'inactive', 'suspended', 'cancelled', 'expired'];
        if (!validStatuses.includes(subscriptionStatus)) {
            return res.status(400).json({ 
                status: 'fail', 
                message: '유효하지 않은 구독 상태입니다.' 
            });
        }

        // 사용자 찾기
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ 
                status: 'fail', 
                message: '사용자를 찾을 수 없습니다.' 
            });
        }

        // 구독 상태 업데이트
        user.subscriptionStatus = subscriptionStatus;
        
        // 구독 상태에 따른 추가 로직
        if (subscriptionStatus === 'active') {
            user.isPremium = true;
        } else if (subscriptionStatus === 'inactive' || subscriptionStatus === 'cancelled' || subscriptionStatus === 'expired') {
            user.isPremium = false;
        }
        
        await user.save();

        res.status(200).json({ 
            status: 'success', 
            message: '구독 상태가 성공적으로 업데이트되었습니다.',
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                subscriptionStatus: user.subscriptionStatus,
                isPremium: user.isPremium
            }
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'error', 
            message: '서버 오류가 발생했습니다.' 
        });
    }
};

// 로그아웃
userController.logout = async (req, res) => {
    try {
        const userId = req.user._id;
        const user = await User.findById(userId);
        
        if (user) {
            user.invalidateSession();
            await user.save();
        }
        
        res.status(200).json({ 
            status: 'success', 
            message: '로그아웃되었습니다.' 
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'fail', 
            message: '서버 오류가 발생했습니다.' 
        });
    }
};

// 최초 회사 관리자 레벨 설정
userController.setInitialCompanyAdmin = async (req, res) => {
    try {
        const userId = req.user.id;
        
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: '사용자를 찾을 수 없습니다.'
            });
        }
        
        
        // 레벨을 10으로 설정
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { level: 10 },
            { new: true, runValidators: true }
        );
        
        
        res.status(200).json({
            success: true,
            message: '최초 회사 관리자 레벨로 설정되었습니다.',
            user: {
                name: updatedUser.name,
                level: updatedUser.level,
                email: updatedUser.email
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '서버 오류가 발생했습니다.'
        });
    }
};

module.exports = userController;
