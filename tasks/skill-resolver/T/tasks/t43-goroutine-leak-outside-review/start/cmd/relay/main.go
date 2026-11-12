package main

import (
	"context"
	"time"

	"github.com/harbor/relay/internal/queue"
)

func main() {
	in := make(chan queue.Message)
	c := &queue.Consumer{In: in, Fwd: webhook{}, Timeout: 5 * time.Second}
	c.Run(context.Background())
}

type webhook struct{}

func (webhook) Forward(ctx context.Context, m queue.Message) error { return nil }
