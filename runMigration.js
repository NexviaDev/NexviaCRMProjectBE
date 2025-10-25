#!/usr/bin/env node

/**
 * 🚀 사용자 직급 필드 마이그레이션 실행 스크립트
 * 
 * 사용법:
 * node runMigration.js
 * 
 * 또는 package.json에 스크립트 추가 후:
 * npm run migrate:positions
 */

const { migrateUserPositions } = require('./migrateUserPositions');

('🎯 CRM 시스템 사용자 직급 필드 마이그레이션');
('=====================================\n');

// 마이그레이션 실행
migrateUserPositions()
    .then(() => {
('\n🎉 마이그레이션이 성공적으로 완료되었습니다!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ 마이그레이션 실행 중 오류가 발생했습니다:', error.message);
        process.exit(1);
    }); 