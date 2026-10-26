// Verified question headers only. All applicant values below are invented.
export const HEADERS = [
  'Timestamp', '이름', '연락처', 'Instagram ID', '이메일',
  '이번 SESSION 002에 신청한 이유를 자유롭게 적어주세요.',
  'KANGJUNGSEOK 강정석 대표님께 직접 묻고 싶은 내용이 있다면 적어주세요.',
  '개인정보 수집 및 이용에 동의하시나요?',
  '이름 / 닉네임', '연락처', '인스타 아이디',
  '2026년 11월 1일(일) 13:00–15:00 SESSION 002에 참석 가능하신가요?',
  'SAMPLAS를 알게 된 지 얼마나 되었나요?',
  '이번 SESSION 002에서 가장 궁금한 이야기는 무엇인가요?',
  '이번 SESSION 002에서 함께 이야기해보고 싶은 내용이 있다면 자유롭게 남겨주세요.',
  '촬영 및 콘텐츠 활용에 동의하시나요?',
  'SESSION 종료 후 짧은 인터뷰에 참여할 의향이 있으신가요?',
  'KANGJUNGSEOK 강정석 대표님께 직접 묻고 싶은 질문이 있다면 남겨주세요.'
];
export const row = (n, patch = {}) => Object.assign([
  '2026-10-20 12:00:' + String(n).padStart(2, '0'), '', '', '', '', '', '', '',
  'Synthetic Applicant ' + n, '0108000' + String(n).padStart(4, '0'), '@Fixture' + n,
  '참석 가능', '합성 기간', '합성 관심 이야기 ' + n, '합성 함께 이야기 ' + n,
  '촬영만 동의, 콘텐츠 활용 거부', '인터뷰 미참여', '합성 대표 질문 ' + n
], patch);
