const express = require('express');
const router = express.Router();
const {
  createNews,
  getAllNews,
  getNewsById,
  updateNews,
  deleteNews,
  searchNews
} = require('../controllers/News.controller');

// 뉴스 생성
router.post('/', createNews);

// 모든 뉴스 조회 (페이지네이션 지원)
router.get('/', getAllNews);

// 뉴스 검색
router.get('/search', searchNews);

// 특정 뉴스 조회
router.get('/:id', getNewsById);

// 뉴스 수정
router.put('/:id', updateNews);

// 뉴스 삭제
router.delete('/:id', deleteNews);

module.exports = router;
