export default function AppLoadingScreen({
    message = "로딩 중입니다",
}: {
    message?: string
}) {
    return (
        <div className="flex min-h-screen items-center justify-center bg-background px-6">
            <div className="flex w-full max-w-sm flex-col items-center rounded-2xl border border-border bg-card px-8 py-10 shadow-sm">
                {/* 로고 자리 */}
                <div className="mb-3 flex items-center justify-center">
                    <img
                        src="/logo.png"
                        alt="Stock & Make"
                        className="h-14 w-14 object-contain"
                    />
                </div>

                {/* 브랜드명 */}
                <div className="text-center">
                    <h1 className="text-lg font-semibold tracking-tight text-foreground">
                        Stock &amp; Make
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        스몰 브랜드를 위한 재고·정산 관리
                    </p>
                </div>

                {/* 로딩 점 애니메이션 */}
                <div className="mt-6 flex items-center gap-2">
                    <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
                    <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-primary/80 [animation-delay:-0.15s]" />
                    <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-primary/60" />
                </div>

                {/* 상태 메시지 */}
                <p className="mt-5 text-sm text-muted-foreground">{message}</p>
            </div>
        </div>
    )
}