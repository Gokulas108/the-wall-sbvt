import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { name, email, mobile, amount } = body as {
      name?: string;
      email?: string;
      mobile?: string;
      amount?: number;
    };

    if (!name || !mobile || !amount) {
      return NextResponse.json(
        { success: false, message: "Name, mobile, and amount are required." },
        { status: 400 }
      );
    }

    const response = await fetch("https://birnagar.org/payment/initiate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ name, email: email || "", mobile, amount, api: true }),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.ok ? 200 : 400 });
  } catch (error) {
    console.error("Payment initiation error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to connect to payment gateway. Please try again." },
      { status: 502 }
    );
  }
}
