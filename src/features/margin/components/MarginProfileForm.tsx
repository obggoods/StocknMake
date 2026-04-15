import { useState } from "react"
import { AppButton } from "@/components/app/AppButton"
import { AppInput } from "@/components/app/AppInput"
import { Label } from "@/components/ui/label"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "@/lib/toast"

export default function MarginProfileForm(props: {
  onSaved: (profileId: string) => void
}) {
  const [name, setName] = useState("")
  const [cost, setCost] = useState("")

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("이름 입력")
      return
    }

    const { data: userData } = await supabase.auth.getUser()
    const user = userData.user
    if (!user) return

    const { data, error } = await supabase
      .from("margin_profiles")
      .insert({
        user_id: user.id,
        name,
        total_cost: Number(cost || 0),
      })
      .select()
      .single()

    if (error) {
      toast.error(error.message)
      return
    }

    toast.success("생성 완료")

    // 🔥 핵심
    props.onSaved(data.id)
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>프로필 이름</Label>
        <AppInput value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <Label>총원가</Label>
        <AppInput
          value={cost}
          onChange={(e) => setCost(e.target.value)}
        />
      </div>

      <div className="flex justify-end">
        <AppButton onClick={handleSave}>
          저장
        </AppButton>
      </div>
    </div>
  )
}