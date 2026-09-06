import type { ReactNode } from "react"

export function AuthLayout({
    children,
}: {
    children: ReactNode
}) {
    return (
        <div className="min-h-screen bg-background text-foreground flex">
            {/* 좌측 폼 영역 */}
            <div className="flex w-full items-center justify-center px-6 py-10 lg:w-1/2">
                <div className="w-full max-w-md">{children}</div>
            </div>

            {/* 우측 브랜드 영역 */}
            <div className="hidden lg:flex w-1/2 items-center justify-center bg-muted">
                <div className="max-w-md space-y-6 px-10">
                    {/* 로고 */}
                    <div className="text-2xl font-semibold">
                        Stock &amp; Make
                    </div>

                    {/* 핵심 설명 */}
                    <div className="space-y-2">
                        <h2 className="text-xl font-semibold leading-snug">
                            소규모 브랜드를 위한
                            <br />
                            재고·제작·정산 관리
                        </h2>

                        <p className="text-sm text-muted-foreground">
                            입점처별 재고 흐름과 정산 내역을
                            하나의 구조로 정리할 수 있는 SaaS입니다.
                        </p>
                    </div>

                    {/* 신뢰 포인트 */}
                    <div className="space-y-2 text-sm text-muted-foreground">
                        <div>• 입점처별 재고 관리</div>
                        <div>• 정산 내역 정리</div>
                        <div>• 제작 수량 관리</div>
                        <div>• 엑셀 업로드 지원</div>
                    </div>
                </div>
            </div>
        </div>
    )
}